import path from "node:path";

export interface WebpackOutputPaths {
  rootDir: string;
  clientDir: string;
  serverDir: string;
}

export function getOutputPaths(
  cwd: string,
  serverEnabled: boolean,
  distDir = "dist",
): WebpackOutputPaths {
  const rootDir = path.resolve(cwd, distDir);
  const clientDir = serverEnabled ? path.join(rootDir, "client") : rootDir;
  const serverDir = path.join(rootDir, "server");

  return {
    rootDir,
    clientDir,
    serverDir,
  };
}
