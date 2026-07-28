#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { runCliProgram } from "./cli-program.js";
import type { DefaultBundlerConfig } from "./index.js";
import { build, dev, prepare } from "./index.js";
import { runInspectCommand } from "./inspect-command.js";
import { loadConfig } from "./load-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
) as { version: string };

let configureLoggingPromise: Promise<void> | undefined;

function getLevelColor(level: string): string {
  if (level === "info") return "\x1b[36m";
  if (level === "warning") return "\x1b[33m";
  if (level === "error" || level === "fatal") return "\x1b[31m";
  return "\x1b[32m";
}

function configureLogging(): Promise<void> {
  configureLoggingPromise ??= configure({
    sinks: {
      console: getConsoleSink({
        formatter: (record) => {
          const time = new Date(record.timestamp).toLocaleTimeString("en-US", {
            hour12: false,
          });
          const levelColor = getLevelColor(record.level);
          const reset = "\x1b[0m";
          const cat = record.category[1]
            ? `\x1b[90m[${record.category[1]}]\x1b[0m `
            : "";
          const msg = record.message.map(String).join("");
          return `${levelColor}${time}${reset} ${cat}${msg}\n`;
        },
      }),
    },
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "warning" },
      { category: ["evjs"], sinks: ["console"], lowestLevel: "info" },
    ],
  });
  return configureLoggingPromise;
}

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<number> {
  await configureLogging();
  const logger = getLogger(["evjs", "cli"]);

  return runCliProgram(argv, {
    version: pkg.version,
    cwd: () => process.cwd(),
    loadConfig: (cwd) => loadConfig<DefaultBundlerConfig>(cwd),
    dev,
    build,
    prepare,
    inspect: runInspectCommand,
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
    reportError(summary, error) {
      logger.error`${summary}: ${error}`;
    },
  });
}
