# RML Runner

A runner in the connector architecture, for more information see [connector-architecture](https://github.com/TREEcg/connector-architecture).


## Usage

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


