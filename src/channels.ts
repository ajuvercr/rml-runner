const CONN = "https://w3id.org/conn#";
type Map = { [label: string]: string };

import { FileReaderConfig, FileWriterConfig } from "@treecg/connector-file";

export const typeNode = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function getType(obj: Map): string {
  const ty = obj[typeNode];

  if (!ty)
    throw "No type field found";
  return ty;
}


function parseBool(stringValue: string): boolean {
  switch (stringValue?.toLowerCase()?.trim()) {
    case "true":
    case "yes":
    case "1":
      return true;

    case "false":
    case "no":
    case "0":
    case null:
    case undefined:
      return false;

    default:
      return JSON.parse(stringValue);
  }
}

export type AllowedConfigs = {
  type: "file",
  config: FileReaderConfig & FileWriterConfig,
};
function objToFileConfig(obj: Map): FileReaderConfig & FileWriterConfig {
  const maybePath = obj[CONN + "filePath"];
  const maybeOnReplace = obj[CONN + "fileOnReplace"];
  const encoding = obj[CONN + "fileEncoding"];
  const maybeReadFirstContent = obj[CONN + "fileReadFirstContent"];

  if (!maybePath) { throw `${CONN + "filePath"} is not specified` };
  const path = maybePath!;
  const onReplace = parseBool(maybeOnReplace);
  const readFirstContent = parseBool(maybeReadFirstContent);


  return {
    path,
    onReplace,
    encoding,
    readFirstContent
  }
}

export function parseMap(map: Map): AllowedConfigs {
  const ty = getType(map);

  if (ty === CONN + "FileReaderChannel" || ty === CONN + "FileWriterChannel") {
    return {
      type: "file",
      config: objToFileConfig(map),
    }
  }

  throw `${ty} is not supported!`;
}
