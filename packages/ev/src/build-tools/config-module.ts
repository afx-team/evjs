import { transform } from "@swc/core";

export interface TranspileTypeScriptConfigOptions {
  filename: string;
}

export async function transpileTypeScriptConfig(
  source: string,
  options: TranspileTypeScriptConfigOptions,
): Promise<string> {
  const result = await transform(source, {
    filename: options.filename,
    sourceMaps: false,
    jsc: {
      parser: {
        syntax: "typescript",
        tsx: true,
      },
      target: "esnext",
    },
    module: {
      type: "es6",
    },
  });

  return result.code;
}
