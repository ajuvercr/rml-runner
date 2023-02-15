import { getArgs } from "./args";
import { Store } from "n3";
import * as N3 from "n3";
import { join } from "path";
import { QueryEngine } from "@comunica/query-sparql";
import { Bindings, BlankNode, Literal, NamedNode, Term } from "@rdfjs/types";
import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import { exec } from "child_process";
import { FileWriterConfig, KafkaWriterConfig, loadReaderConfig, loadWriterConfig, MatchFunction } from "@treecg/connector-all";

import { getJarFile, load_store } from "./util";
import { handleLogicalSource } from "./mapping";

export const Factory = N3.DataFactory;

const query = `
PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX : <https://w3id.org/conn#> 
PREFIX rml: <https://w3id.org/conn/rml#>

SELECT * WHERE {

?subject a rml:ExecRML;
  rml:input ?input;
  rml:output ?output;
  rml:mappingFile ?mapping.

?input a ?inputType.
?output a ?outputType.

OPTIONAL { ?subject rml:jarFile ?jarFile. }
OPTIONAL { ?subject rml:iterator ?iterator. }
OPTIONAL { ?subject rml:referenceFormulation ?referenceFormulation. }
}
`;

const CONFIG_KEYS: (keyof Configs)[] = ["subject", "input", "output", "mapping", "inputType", "outputType", "iterator", "jarFile", "referenceFormulation"];
export type Configs = {
  subject: Term,
  input: NamedNode | BlankNode,
  output: NamedNode | BlankNode,
  mapping: NamedNode,
  inputType: NamedNode,
  outputType: NamedNode,
  jarFile?: Literal,
  iterator?: Literal,
  referenceFormulation?: NamedNode,
}

const engine = new QueryEngine();


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

const rmlStreamerRelease = "https://github.com/RMLio/RMLStreamer/releases/download/v2.4.2/RMLStreamer-2.4.2-standalone.jar";

async function startRMLStreamer(store: Store, binding: Configs, offline: boolean) {
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
  const rmlStore = new N3.Store();
  await load_store(binding.mapping.value, rmlStore);

  handleLogicalSource(rmlStore, inputConfig, binding);

  // Write to somewhere
  const randomFileName = "/tmp/rml-" + randomUUID() + ".ttl";
  const writer = new N3.Writer();
  const ser = writer.quadsToString(rmlStore.getQuads(null, null, null, null));

  await writeFile(randomFileName, ser);
  flags.push("-m", randomFileName);

  const jarFile = await getJarFile(binding.jarFile?.value, offline, rmlStreamerRelease);
  const cmd = `java -jar ${jarFile} ${flags.join(" ")}`;
  console.log("Executing $", cmd);

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
  const args = getArgs();
  const input = args.input;
  const cwd = process.cwd();

  const store = new N3.Store();
  await load_store(join(cwd, input), store);

  const bindings = await engine.queryBindings(query, { sources: [store] });

  const results = await bindings.toArray();

  const procs = results.map(parseBinding).map(x => startRMLStreamer(store, x, args.offline));

  await Promise.all(procs);
}

main().catch((e: Error) => { console.error("Error:", e); console.error(e.stack) });

