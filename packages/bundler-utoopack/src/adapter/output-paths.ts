import path from "node:path";

export interface UtoopackOutputPaths {
  rootDir: string;
  clientDir: string;
  serverDir: string;
}

export interface OutputDirectoryConfig {
  client: string;
  server: string;
}

export function getOutputPaths(
  cwd: string,
  output: OutputDirectoryConfig,
  distDir = "dist",
): UtoopackOutputPaths {
  const rootDir = path.resolve(cwd, distDir);
  const clientDir = path.resolve(cwd, output.client);
  const serverDir = path.resolve(cwd, output.server);

  return {
    rootDir,
    clientDir,
    serverDir,
  };
}
