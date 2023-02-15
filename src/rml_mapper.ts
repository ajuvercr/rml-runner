import { FileReaderConfig } from "@treecg/connector-all";
import { SimpleStream, Stream, Writer } from "@treecg/connector-types";
import { exec } from "child_process";
import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { Parser, Store, DataFactory, Writer as N3Writer } from "n3";
import { handleLogicalSource, SourceConfig } from "./mapping";
import { getJarFile } from "./util";

const { literal, namedNode } = DataFactory;

export async function rml_mapper_string(reader: Stream<string>, writer: Writer<string>, mapping: string, referenceFormulation?: string, iterator?: string, jarLocation?: string) {
  const simple_stream = new SimpleStream<string>();
  const content = await readFile(mapping);
  simple_stream.push(content.toString());
  await rml_mapper_reader(reader, writer, simple_stream, referenceFormulation, iterator, jarLocation);
}

const rmlMapperRelease = "https://github.com/RMLio/rmlmapper-java/releases/download/v6.1.3/rmlmapper-6.1.3-r367-all.jar";
export async function rml_mapper_reader(reader: Stream<string>, writer: Writer<string>, mapping: Stream<string>, referenceFormulation?: string, iterator?: string, jarLocation?: string) {
  const mappingFile = "/tmp/rml-" + randomUUID() + ".ttl";
  const inputFile = "/tmp/rml-input-" + randomUUID() + ".ttl";
  const outputFile = "/tmp/rml-output-" + randomUUID() + ".ttl";

  const jarFile = await getJarFile(jarLocation, false, rmlMapperRelease);
  const command = `java -jar ${jarFile} -m ${mappingFile} -o ${outputFile}`;

  /// Handle new mapping file, setting the logical source to `inputFile`
  const mappingHandler = async (contents: string) => {
    const parser = new Parser();
    const rmlStore = new Store();
    rmlStore.addQuads(parser.parse(contents));

    const fileReaderConfig: FileReaderConfig = { path: inputFile, onReplace: false };

    const sourceConfig: SourceConfig = {};
    if (referenceFormulation) {
      sourceConfig.referenceFormulation = namedNode(referenceFormulation);
    }
    if (iterator) {
      sourceConfig.iterator = literal(iterator);
    }
    handleLogicalSource(rmlStore, { type: "file", config: fileReaderConfig }, sourceConfig);

    const writer = new N3Writer();
    const ser = writer.quadsToString(rmlStore.getQuads(null, null, null, null));

    await writeFile(mappingFile, ser);
  };

  mapping.data(mappingHandler);
  if (mapping.lastElement) {
    mappingHandler(mapping.lastElement);
  }


  // Handle new incoming data;
  // Writting the data to disk and executing the rml mapper;
  // Lastly reading the data and sending it to the writer
  const dataHandler = async (data: string) => {
    await writeFile(inputFile, data);

    const proc = exec(command);

    proc.stdout!.on('data', function(data) {
      console.log("rml mapper std: ", data.toString());
    });
    proc.stderr!.on('data', function(data) {
      console.error("rml mapper err:", data.toString());
    });
    await new Promise(res => proc.on('exit', res));


    const content = await readFile(outputFile);
    await writer.push(content.toString());
  };

  reader.data(dataHandler);
  if (reader.lastElement) {
    dataHandler(reader.lastElement);
  }
}
