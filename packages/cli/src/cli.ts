#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configure,
  defaultTextFormatter,
  getConsoleSink,
  getLogger,
} from "@logtape/logtape";
import { Command } from "commander";
import { build, dev } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await configure({
  sinks: {
    console: getConsoleSink({
      formatter: (record) => {
        const time = new Date(record.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
        });
        const levelColor =
          record.level === "info"
            ? "\x1b[36m"
            : record.level === "warning"
              ? "\x1b[33m"
              : record.level === "error" || record.level === "fatal"
                ? "\x1b[31m"
                : "\x1b[32m";
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

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
);
const program = new Command();

program
  .name("ev")
  .description("CLI for the evjs framework")
  .version(pkg.version);

const logger = getLogger(["evjs", "cli"]);

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    const { loadConfig } = await import("./load-config.js");
    const config = await loadConfig(cwd);
    try {
      await dev(config ?? undefined, { cwd });
    } catch (err) {
      logger.error`Failed to start dev server: ${err}`;
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build project for production")
  .action(async () => {
    const cwd = process.cwd();
    const { loadConfig } = await import("./load-config.js");
    const config = await loadConfig(cwd);
    try {
      await build(config ?? undefined, { cwd });
    } catch (err) {
      logger.error`Build failed: ${err}`;
      process.exit(1);
    }
  });

program.parse();
