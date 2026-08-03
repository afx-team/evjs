#!/usr/bin/env node
import { runCreateAppCli } from "../dist/index.js";

try {
  await runCreateAppCli(process.argv);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
