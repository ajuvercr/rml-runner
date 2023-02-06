import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";

const optionDefinitions = [
  { name: 'input', type: String, defaultOption: true, summary: "Specify what input file to start up" },
  { name: 'offline', alias: 'f', type: Boolean, description: "Runs the runner in offline mode, panicking when the jar file is not found. Otherwise get release RMLStreamer-2.4.2-standalone.jar" },
  { name: 'help', alias: 'h', type: Boolean, description: "Display this help message" },
];

const sections = [
  {
    header: "Js-runner",
    content: "JS-runner is part of the {italic connector architecture}. Starting from an input file start up all JsProcessors that are defined."
  },
  {
    header: "Synopsis",
    content: "$ js-runner <options> <input>"
  },
  {
    header: "Command List",
    content: [{ name: "input", summary: "Specify what input file to start up" }],
  },
  {
    optionList: [optionDefinitions[1], optionDefinitions[2]]
  }
];

export type Args = {
  input: string,
  offline: boolean,
};

function validArgs(args: any): boolean {
  if (!args.input) return false;
  return true;
}

function printUsage() {
  const usage = commandLineUsage(sections);
  console.log(usage);
  process.exit(0);
}

export function getArgs(): Args {
  let args: any;
  try {
    args = commandLineArgs(optionDefinitions);
  } catch (e) {
    console.error(e);
    printUsage();
  }

  if (args.help || !validArgs(args)) {
    printUsage();
  }

  return <Args>args;
}



