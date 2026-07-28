#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

try {
  process.exitCode = await runCli(process.argv);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
