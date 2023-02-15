import { Store } from "n3";
import { BlankNode, Literal, NamedNode } from "@rdfjs/types";
import { RDF } from "@treecg/types";
import { CSVW, QL, RML, RMLS, RR } from "./voc";
import { FileReaderConfig, KafkaReaderConfig, ReaderConfig } from "@treecg/connector-all";
import { Configs, Factory } from "./index";
import { recursiveDelete } from "./util";

export type SourceConfig = {
  referenceFormulation?: NamedNode,
  iterator?: Literal,
};

function setFileSource(logicalSource: NamedNode | BlankNode, config: SourceConfig, readerConfig: FileReaderConfig, store: Store) {
  const file = readerConfig.path;
  if (file.endsWith("json") || file.endsWith("xml") || config.referenceFormulation?.value == QL.XPath || config.referenceFormulation?.value === QL.JSONPath) {
    const ref = config.referenceFormulation || (file.endsWith("json") ? QL.terms.JSONPath : QL.terms.XPath);
    const iterator = config.iterator || (file.endsWith("json") ? Factory.literal("$") : Factory.literal("/"));
    store.addQuads([
      Factory.quad(logicalSource, RML.terms.source, Factory.literal(file)),
      Factory.quad(logicalSource, RML.terms.referenceFormulation, ref),
      Factory.quad(logicalSource, RML.terms.iterator, iterator),
    ]);
  } else if (file.endsWith("tsv") || file.endsWith("csv")) {
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
  } else {
    throw "Could not deduce enough information from filename " + file;
  }
}
function setKafkaSource(logicalSource: NamedNode | BlankNode, config: SourceConfig, readerConfig: KafkaReaderConfig, store: Store) {
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
  ]);
}
export function handleLogicalSource(store: Store, config: { "type": string; config: ReaderConfig; }, rml: SourceConfig) {
  const mappings = store.getSubjects(RDF.terms.type, RR.terms.TriplesMap, null);
  if (mappings.length !== 1) {
    throw `Expected one mapping, found ${mappings.length}`;
  }
  const mapping = mappings[0];

  // Delete lingering logicalSources
  store.getObjects(mapping, RML.logicalSource, null).forEach(s => recursiveDelete(s, store));

  // Delete lingering logicalTargets
  store.getQuads(null, RML.custom("logicalTarget"), null, null).forEach(q => {
    store.delete(q);
    recursiveDelete(q.object, store)
  });

  const id = store.createBlankNode();
  const logicalSource = id;
  store.addQuads([
    Factory.quad(
      mapping, RML.terms.logicalSource, id
    ),
  ]);

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

