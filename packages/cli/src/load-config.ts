import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "@evjs/ev";

const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

/**
 * Load evjs config from the project root.
 *
 * Looks for `ev.config.ts`, `.js`, or `.mjs` in the given directory.
 * Returns undefined if no config file is found.
 */
export async function loadConfig<TBundlerCfg = unknown>(
  cwd: string,
): Promise<Config<TBundlerCfg> | undefined> {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) {
      return importConfigFile<TBundlerCfg>(configPath);
    }
  }
  return undefined;
}

async function importConfigFile<TBundlerCfg>(
  configPath: string,
): Promise<Config<TBundlerCfg>> {
  if (path.extname(configPath) === ".ts") {
    return importTypeScriptConfig<TBundlerCfg>(configPath);
  }
  return importConfigModule<TBundlerCfg>(configPath);
}

async function importTypeScriptConfig<TBundlerCfg>(
  configPath: string,
): Promise<Config<TBundlerCfg>> {
  const { transpileTypeScriptConfig } = await import("@evjs/ev/build-tools");
  const source = await fsp.readFile(configPath, "utf-8");
  const code = await transpileTypeScriptConfig(source, {
    filename: configPath,
  });
  const tempPath = createTempModulePath(configPath, source);

  try {
    await fsp.writeFile(tempPath, code, { mode: 0o600 });
    return await importConfigModule<TBundlerCfg>(tempPath);
  } finally {
    await removeTempModule(tempPath);
  }
}

async function importConfigModule<TBundlerCfg>(
  configPath: string,
): Promise<Config<TBundlerCfg>> {
  const configUrl = pathToFileURL(configPath);
  configUrl.searchParams.set(
    "t",
    `${Date.now()}-${randomBytes(4).toString("hex")}`,
  );
  const mod = await import(configUrl.href);
  return mod.default ?? mod;
}

function createTempModulePath(configPath: string, source: string): string {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const nonce = `${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  return path.join(
    path.dirname(configPath),
    `.evjs.config-${hash}-${nonce}.mjs`,
  );
}

async function removeTempModule(tempPath: string): Promise<void> {
  try {
    await fsp.unlink(tempPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
