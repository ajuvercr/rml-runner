import { getArgs } from "./args";
import { Store, StreamParser } from "n3";
import * as N3 from "n3";
import { createReadStream } from "fs";
import { join } from "path";
import { QueryEngine } from "@comunica/query-sparql";
import { Bindings, BlankNode, Literal, NamedNode, Term } from "@rdfjs/types";
import { RDF } from "@treecg/types";
import { CSVW, QL, RML, RMLS, RR } from "./voc";
import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import { exec } from "child_process";
import { FileReaderConfig, FileWriterConfig, KafkaReaderConfig, KafkaWriterConfig, loadReaderConfig, loadWriterConfig, MatchFunction, ReaderConfig } from "@treecg/connector-all";

const Factory = N3.DataFactory;

const query = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX : <https://w3id.org/conn#> 
PREFIX rml: <https://w3id.org/conn/rml#>

SELECT * WHERE {

?subject a rml:ExecRML;
  rml:input ?input;
  rml:output ?output;
  rml:jarFile ?jarFile;
  rml:mappingFile ?mapping.

?input a ?inputType.
?output a ?outputType.

OPTIONAL { ?subject rml:iterator ?iterator. }
OPTIONAL { ?subject rml:referenceFormulation ?iterator. }
}
`;

const CONFIG_KEYS: (keyof Configs)[] = ["subject", "input", "output", "mapping", "inputType", "outputType", "iterator", "jarFile", "referenceFormulation"];
type Configs = {
  subject: Term,
  input: NamedNode | BlankNode,
  output: NamedNode | BlankNode,
  mapping: NamedNode,
  inputType: NamedNode,
  outputType: NamedNode,
  jarFile: Literal,
  iterator?: Literal,
  referenceFormulation?: NamedNode,
}

const engine = new QueryEngine();
// TODO: use done
const done = new Set();
async function importFile(file: string, dir?: string): Promise<Store> {
  const store = new Store();
  const parser = new StreamParser({ baseIRI: dir });
  const rdfStream = createReadStream(file);
  rdfStream.pipe(parser);

  await new Promise(res => store.import(parser).on('end', res));
  return store;
}

function assign_key<K extends keyof Configs>(key: K, binding: Bindings, conf: Configs) {
  conf[key] = <Configs[K]>binding.get(key);
}

function parseBinding(binding: Bindings): Configs {
  const out = {} as Configs;
  for (let key of CONFIG_KEYS) {
    assign_key(key, binding, out);
  }

  return out;
}

function recursiveDelete(subject: Term, store: Store) {
  for (let q of store.getQuads(subject, null, null, null)) {
    store.delete(q);
    recursiveDelete(q.object, store);
  }
}

function setFileSource(logicalSource: NamedNode | BlankNode, config: Configs, readerConfig: FileReaderConfig, store: Store) {
  const file = readerConfig.path;
  if (file.endsWith("json") || file.endsWith("xml")) {
    const ref = config.referenceFormulation || (file.endsWith("json") ? QL.terms.JSONPath : QL.terms.XPath);
    const iterator = config.iterator || (file.endsWith("json") ? Factory.literal("$") : Factory.literal("/"));
    store.addQuads([
      Factory.quad(logicalSource, RML.terms.source, Factory.literal(file)),
      Factory.quad(logicalSource, RML.terms.referenceFormulation, ref),
      Factory.quad(logicalSource, RML.terms.iterator, iterator),
    ])
  }
  if (file.endsWith("tsv") || file.endsWith("csv")) {
    const id = store.createBlankNode();
    const dialect = store.createBlankNode();
    const extras = file.endsWith("tsv") ? [
      Factory.quad(id, CSVW.terms.dialect, dialect),
      Factory.quad(dialect, RDF.terms.type, CSVW.terms.Dialect),
      Factory.quad(dialect, CSVW.terms.delimiter, Factory.literal("\\t")),
    ] : [];

    store.addQuads([
      Factory.quad(logicalSource, RML.terms.source, id),
      Factory.quad(id, RDF.terms.type, CSVW.terms.Table),
      Factory.quad(id, CSVW.terms.url, Factory.literal(file)),
      Factory.quad(logicalSource, RML.terms.referenceFormulation, QL.terms.CSV),
      ...extras,
    ]);
  }
}
function setKafkaSource(logicalSource: NamedNode | BlankNode, config: Configs, readerConfig: KafkaReaderConfig, store: Store) {
  const ref = config.referenceFormulation || QL.terms.JSONPath;
  const iterator = config.iterator || Factory.literal("$");
  const id = store.createBlankNode();
  store.addQuads([
    Factory.quad(logicalSource, RML.terms.referenceFormulation, ref),
    Factory.quad(logicalSource, RML.terms.iterator, iterator),
    Factory.quad(logicalSource, RML.terms.source, id),
    Factory.quad(id, RDF.terms.type, RMLS.terms.KafkaStream),
    Factory.quad(id, RMLS.terms.topic, Factory.literal(readerConfig.topic.name)),
    Factory.quad(id, RMLS.terms.broker, Factory.literal(<string>readerConfig.broker)),
    Factory.quad(id, RMLS.terms.groupId, Factory.literal(readerConfig.consumer.groupId)),
  ])
}

function handleLogicalSource(store: Store, config: { "type": string, config: ReaderConfig }, rml: Configs) {
  const mappings = store.getSubjects(RDF.terms.type, RR.terms.TriplesMap, null);
  if (mappings.length !== 1) {
    throw `Expected one mapping, found ${mappings.length}`
  }
  const mapping = mappings[0];

  const logicalSources = store.getObjects(mapping, RML.logicalSource, null);
  if (logicalSources.length > 1) {
    throw `Expected at most, one logicalSource, found ${logicalSources.length}`
  }
  if (logicalSources.length < 1) {
    const id = store.createBlankNode();
    logicalSources.push(id);
    store.addQuads([
      Factory.quad(
        mapping, RML.terms.logicalSource, id,
      ),
    ]);
  }

  const logicalSource = logicalSources[0];
  store.getObjects(logicalSource, RML.source, null).forEach(s => recursiveDelete(s, store));

  switch (config.type) {
    case "file":
      const fileConfig = <FileReaderConfig>config.config;
      setFileSource(<NamedNode | BlankNode>logicalSource, rml, fileConfig, store);
      break;
    case "kafka":
      const kafkaConfig = <KafkaReaderConfig>config.config;
      setKafkaSource(<NamedNode | BlankNode>logicalSource, rml, kafkaConfig, store);
      break;
    default:
      throw `RML Streamer does not support ${config.type} as source`;

  }

}


async function startRML(store: Store, binding: Configs) {
  const match: MatchFunction = async (s, p, o) => store.getQuads(<any>s, <any>p, <any>o, null);
  const inputConfig = await loadReaderConfig(binding.input, match);
  const outputConfig = await loadWriterConfig(binding.output, match);

  const flags: string[] = [];
  switch (outputConfig.type) {
    case "file":
      const fileConfig = <FileWriterConfig>outputConfig.config;
      flags.push("toFile", "-o", fileConfig.path)
      break;
    case "kafka":
      const kafkaConfig = <KafkaWriterConfig>outputConfig.config;
      flags.push("toKafka", "-b", <string>kafkaConfig.broker, "-t", kafkaConfig.topic.name);
      break;
    default:
      throw `RML Streamer does not support ${outputConfig.type} as target`;
  }

  // Load and change rml mapping file
  const rmlStore = await importFile(binding.mapping.value);
  handleLogicalSource(rmlStore, inputConfig, binding);

  // Write to somewhere
  const randomFileName = "/tmp/rml" + randomUUID() + ".ttl";
  const writer = new N3.Writer();
  const ser = writer.quadsToString(rmlStore.getQuads(null, null, null, null));

  await writeFile(randomFileName, ser);
  flags.push("-m", randomFileName);


  const cmd = `java -jar ${binding.jarFile.value} ${flags.join(" ")}`;
  console.log("Executing $", cmd)

  const proc = exec(cmd);

  proc.stdout!.on('data', function(data) {
    console.log("rml std: ", data.toString());
  });
  proc.stderr!.on('data', function(data) {
    console.error("rml err:", data.toString());
  });

  await new Promise(res => proc.on('exit', res));
}

async function main() {
  const input = getArgs().input;
  const cwd = process.cwd();

  const store = await importFile(input, join(cwd, input));

  const bindings = await engine.queryBindings(query, { sources: [store] });

  const results = await bindings.toArray();

  const procs = results.map(parseBinding).map(x => startRML(store, x));

  await Promise.all(procs);
}

main().catch((e: Error) => { console.error("Error:", e); console.error(e.stack) });
