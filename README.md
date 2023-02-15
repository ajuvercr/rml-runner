# RML Runner

A runner in the connector architecture, for more information see [connector-architecture](https://github.com/TREEcg/connector-architecture).

## RML Streamer

The rml streamer can be used inside the connector architecture using this rml runner.

The application will help you get the required standalone jar file and link channels into the streamer.

### Usage

Download the RML Streamer (standalone is fine) from [github](https://github.com/RMLio/RMLStreamer/releases/tag/v2.4.2). 
Create a mapping file (by hand or yarrrml).

Configure your pipeline, an example pipeline would be something like this (file channels are also supported):
Note: *Always use named nodes for your channels, blank nodes will fail*

```turtle
@prefix : <https://w3id.org/conn#> .
@prefix rml: <https://w3id.org/conn/rml#> .

<inputStream> a :KafkaReaderChannel;
  :kafkaTopic "rmlinput";
  :kafkaBroker "localhost:9092";
  :kafkaGroup "group-2".

<outputStream> a :KafkaWriterChannel;
  :kafkaTopic "rml";
  :kafkaBroker "localhost:9092".

[] a rml:ExecRML;
  rml:jarFile "./RMLStreamer-2.4.2-standalone.jar";
  rml:mappingFile "./mapping.ttl";
  rml:input <inputStream>;
  rml:iterator "$";
  rml:output <outputStream>.
```


Compile the runner
```
npm install
tsc
```

Run the runner
```
node lib/index.js run.ttl
```


## RML Mapper

The rml mapper can also be used inside the connector architecture, using the rmlMapper js-processor.
This processor links, as any other js-processor, with any channel.

When a new message is received, this message is written to a file that is then used by the mapper.
This may not the be fastest, but it is the most flexible.


### Usage

```turtle
@prefix : <https://w3id.org/conn#> .
@prefix js: <https://w3id.org/conn/js#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rml: <https://w3id.org/conn/rml#> .
@prefix ql: <http://semweb.mmlab.be/ns/ql#> .

<> owl:imports <./rmlMapper.ttl>.

<raw/reader-js> a :JsReaderChannel.
<ld/writer-js> a :JsWriterChannel.

<mapping/reader-js> a :JsReaderChannel.

[] a js:RmlMapperString;
  js:rml_data_input <raw/reader-js>;
  js:rml_data_output <ld/writer-js>;
  js:rml_mapping_location <./mappings/SoLTracks-LDES.rml.ttl>;
  rml:referenceFormulation ql:XPath;
  rml:iterator "/RINFData//SOLTrack";
  rml:jarFile <./rml-mapper-6.x.x.jar>.
  
[] a js:RmlMapperReader;
  js:rml_data_input <raw/reader-js>;
  js:rml_data_output <ld/writer-js>;
  js:rml_mapping_reader <mapping/reader-js>;
  rml:referenceFormulation ql:XPath;
  rml:iterator "/RINFData//SOLTrack";
  rml:jarFile <./rml-mapper-6.x.x.jar>.
```

Note the difference between `js:RmlMapperString` and `js:RmlMapperReader`, the string variant takes a static location to the mapping file, while the reader takes in a channel with mapping files.


