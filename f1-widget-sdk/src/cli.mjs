import path from "node:path";

import { buildAssetBank } from "./assets.mjs";
import { SDK_ROOT } from "./constants.mjs";
import { buildWidget, inspectImage } from "./firmware.mjs";
import { initProject } from "./scaffold.mjs";
import { initMediaProject } from "./media-scaffold.mjs";
import { loadWidgetSpec } from "./spec.mjs";
import { deployAppOnly } from "./device-workflow.mjs";
import { prepareStage3e3 } from "./stage3e3.mjs";
import { buildCombinedFirmware } from "./combined-firmware.mjs";
import { stableJson } from "./util.mjs";
import { runMediaCli } from "./media-transport/cli.mjs";

const usage = `Usage:
  f1-widget init <directory>
  f1-widget init-media <directory>
  f1-widget validate [project-directory]
  f1-widget build [project-directory] [--out <directory>]
  f1-widget inspect <app-or-merged-image>
  f1-widget stage3e3 [--manifest <file>] [--out <directory>]
  f1-widget combined [--out <directory>]
  f1-widget media status
  f1-widget media inspect [--port <number>]
  f1-widget media mock
  f1-widget deploy --app <file> --approval <file> [--rollback <file>]
                   [--full-readback] --confirm-app-only

stage3e3 is the cached validate/build/ABI/image-info/hash/rollback preflight.
deploy is an opt-in same-device app-only workflow and rejects runtime NO-GO reports.`;

function parseBuildArguments(args) {
  let project = ".";
  let output;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") {
      output = args[index + 1];
      if (!output) throw new Error("--out requires a directory.");
      index += 1;
    } else if (project === ".") project = args[index];
    else throw new Error(`Unexpected build argument ${args[index]}.`);
  }
  const projectRoot = path.resolve(project);
  return { projectRoot, output: path.resolve(output ?? path.join(projectRoot, "build")) };
}

function parseNamedArguments(args, definitions) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const definition = definitions[arg];
    if (!definition) throw new Error(`Unknown argument ${arg}.`);
    if (definition === "boolean") options[arg] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      options[arg] = value;
    }
  }
  return options;
}

export async function runCli(argv, io = console) {
  const [command, ...args] = argv;
  if (!command || ["-h", "--help", "help"].includes(command)) {
    io.log(usage);
    return 0;
  }
  if (command === "init") {
    if (args.length !== 1) throw new Error("init requires exactly one destination directory.");
    const projectRoot = await initProject(args[0]);
    io.log(stableJson({ status: "created", projectRoot, next: [
      `node ${path.join(SDK_ROOT, "bin/f1-widget.mjs")} validate ${projectRoot}`,
      `node ${path.join(SDK_ROOT, "bin/f1-widget.mjs")} build ${projectRoot}`,
    ] }).trimEnd());
    return 0;
  }
  if (command === "init-media") {
    if (args.length !== 1) throw new Error("init-media requires exactly one destination directory.");
    const projectRoot = await initMediaProject(args[0]);
    io.log(stableJson({ status: "created-media-project", projectRoot, next: [
      `npm --prefix ${projectRoot} test`,
      `npm --prefix ${projectRoot} run demo`,
    ], hardwareAccess: false }).trimEnd());
    return 0;
  }
  if (command === "validate") {
    if (args.length > 1) throw new Error("validate accepts at most one project directory.");
    const { specPath, spec } = await loadWidgetSpec(args[0] ?? ".");
    const assets = await buildAssetBank(spec);
    io.log(stableJson({
      status: "valid",
      spec: specPath,
      widget: spec.name,
      target: `${spec.target.device} ${spec.target.firmware}`,
      logicalCanvas: `${spec.target.logicalCanvas.width}x${spec.target.logicalCanvas.height}`,
      physicalDisplay: `${spec.target.physicalDisplay.width}x${spec.target.physicalDisplay.height}`,
      species: spec.assets.roster.length,
      frames: assets.assets.length,
      nativeAssetBytes: assets.bank.length,
      guardedDromGrowthBytes: assets.padded.length,
      guardedDromGrowthPages: assets.padded.length / 0x10000,
      dromGrowthRule: "ceil(nativeAssetBytes / 0x10000) * 0x10000",
      runtimeImageStatus: assets.runtimeImageEvidence.status,
      liveVisualApproved: assets.runtimeImageEvidence.liveVisualApproved,
      hardwareAccess: false,
    }).trimEnd());
    return 0;
  }
  if (command === "build") {
    const { projectRoot, output } = parseBuildArguments(args);
    const { spec } = await loadWidgetSpec(projectRoot);
    const result = await buildWidget(spec, output);
    io.log(stableJson({
      status: result.manifest.status,
      widget: spec.name,
      output: result.outputRoot,
      manifest: path.join(result.outputRoot, result.outputNames.manifest),
      app: result.manifest.outputs.app,
      hardwareAccess: false,
    }).trimEnd());
    return 0;
  }
  if (command === "inspect") {
    if (args.length !== 1) throw new Error("inspect requires exactly one image path.");
    io.log(stableJson(await inspectImage(args[0])).trimEnd());
    return 0;
  }
  if (command === "stage3e3") {
    const options = parseNamedArguments(args, { "--manifest": "value", "--out": "value" });
    const result = await prepareStage3e3({
      manifestPath: options["--manifest"] ? path.resolve(options["--manifest"]) : undefined,
      outputDirectory: options["--out"] ? path.resolve(options["--out"]) : undefined,
    });
    io.log(stableJson({
      status: result.report.status,
      deployable: result.report.deployable,
      app: result.report.outputs.app,
      report: result.reportPath,
      cache: result.report.cache,
      elapsedMs: result.report.timings.totalMs,
      hardwareAccess: false,
    }).trimEnd());
    return 0;
  }
  if (command === "combined") {
    const options = parseNamedArguments(args, { "--out": "value" });
    const result = await buildCombinedFirmware({
      outputDirectory: options["--out"] ? path.resolve(options["--out"]) : undefined,
    });
    io.log(stableJson({ status: result.report.status, deployable: result.report.deployable,
      app: result.report.outputs.app, code: result.report.code, report: result.reportPath,
      approvalDraft: result.approvalDraftPath, elapsedMs: result.report.elapsedMs,
      hardwareAccess: false }).trimEnd());
    return 0;
  }
  if (command === "media") return runMediaCli(args, io);
  if (command === "deploy") {
    const options = parseNamedArguments(args, {
      "--app": "value", "--approval": "value", "--rollback": "value",
      "--full-readback": "boolean", "--confirm-app-only": "boolean",
    });
    if (!options["--app"] || !options["--approval"]) {
      throw new Error("deploy requires --app and --approval.");
    }
    const result = await deployAppOnly({
      appPath: options["--app"], approvalPath: options["--approval"],
      rollbackPath: options["--rollback"], fullReadback: options["--full-readback"] === true,
      confirmed: options["--confirm-app-only"] === true,
    });
    io.log(stableJson({ status: "DEVICE_HEALTHY", receipt: result.receiptPath,
      mode: result.receipt.mode, app: result.receipt.app }).trimEnd());
    return 0;
  }
  throw new Error(`Unknown command ${command}.\n\n${usage}`);
}

export { usage };
