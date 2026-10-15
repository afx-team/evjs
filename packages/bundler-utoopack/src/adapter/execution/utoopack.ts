/**
 * Keep project-relative inputs anchored to the application while allowing
 * Utoopack to discover the enclosing workspace root for hoisted dependencies.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";

type UtoopackBuildRuntime = Pick<typeof import("@utoo/pack"), "build">;
type UtoopackDevRuntime = Pick<typeof import("@utoo/pack"), "serve">;
type UtoopackServerOptions = NonNullable<
  Parameters<UtoopackDevRuntime["serve"]>[3]
>;

async function prepareServerOnlyEntry(
  config: ConfigComplete,
  projectPath: string,
) {
  if (config.entry?.length !== 0 || !config.server?.entry) {
    return { config, dispose: async () => {} };
  }
  // Utoopack derives server endpoints from an application entry. Keep its
  // empty anchor private: it is not a framework client entry or public asset.
  const serverEntry =
    typeof config.server.entry === "string"
      ? config.server.entry
      : config.server.entry[0].import;
  const anchorDir = await fs.mkdtemp(
    path.join(
      path.dirname(path.resolve(projectPath, serverEntry)),
      ".evjs-server-build-",
    ),
  );
  const anchor = path.join(anchorDir, "entry.js");
  const dispose = () => fs.rm(anchorDir, { recursive: true, force: true });
  try {
    await fs.writeFile(anchor, "export {};\n");
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    config: {
      ...config,
      entry: [{ name: "__evjs_server_anchor", import: anchor }],
      output: { ...config.output, path: path.join(anchorDir, "client") },
    },
    dispose,
  };
}

export async function runUtoopackBuild(
  runtime: UtoopackBuildRuntime,
  config: ConfigComplete,
  projectPath: string,
): Promise<void> {
  const prepared = await prepareServerOnlyEntry(config, projectPath);
  try {
    await runtime.build({ config: prepared.config }, projectPath);
  } finally {
    await prepared.dispose();
  }
}

export async function runUtoopackDevServer(
  runtime: UtoopackDevRuntime,
  config: ConfigComplete,
  projectPath: string,
  serverOptions: UtoopackServerOptions,
): Promise<() => Promise<void>> {
  const prepared = await prepareServerOnlyEntry(config, projectPath);
  try {
    await runtime.serve(
      { config: prepared.config },
      projectPath,
      undefined,
      serverOptions,
    );
    // serve resolves on readiness. The dev session owns the anchor until close.
    return prepared.dispose;
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
}
