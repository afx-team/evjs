#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getConsoleSink } from "@logtape/logtape";
import { Command } from "commander";
import fs from "node:fs";
import { build, dev } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["logtape", "meta"], lowestLevel: "warning" },
    { category: ["evjs"], sinks: ["console"], lowestLevel: "info" },
  ],
});

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
const program = new Command();

program
  .name("ev")
  .description("CLI for the evjs framework")
  .version(pkg.version);

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    const { loadConfig } = await import("./load-config.js");
    const config = await loadConfig(cwd, { mode: "development" });
    try {
      await dev(config ?? undefined, { cwd });
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build project for production")
  .action(async () => {
    const cwd = process.cwd();
    const { loadConfig } = await import("./load-config.js");
    const config = await loadConfig(cwd, { mode: "production" });
    try {
      await build(config ?? undefined, { cwd });
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

program.parse();
