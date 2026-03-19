import { transformServerFile } from "@evjs/build-tools";
import type { Compiler } from "webpack";

interface LoaderContext {
  async(): (err: Error | null, result?: string, sourceMap?: unknown) => void;
  getOptions(): { isServer?: boolean };
  resourcePath: string;
  rootContext: string;
  _compiler?: Compiler & {
    _ev_manifest_collector?: {
      addServerFn(id: string, meta: { moduleId: string; export: string }): void;
    };
  };
}

/**
 * Webpack loader for "use server" files.
 * Thin wrapper that delegates to @evjs/build-tools for the actual transformation.
 */
export default async function serverFnLoader(
  this: LoaderContext,
  source: string,
): Promise<void> {
  const callback = this.async();
  try {
    const explicitOptions = this.getOptions() || {};
    let isServer = explicitOptions.isServer;
    if (typeof isServer === "undefined") {
      const compilerName = this._compiler?.name;
      const target = this._compiler?.options?.target;
      isServer = compilerName === "evServer" || target === "node";
    }

    const manifestCollector = this._compiler?._ev_manifest_collector;

    const result = await transformServerFile(source, {
      resourcePath: this.resourcePath,
      rootContext: this.rootContext,
      isServer: !!isServer,
      onServerFn: manifestCollector
        ? (fnId, meta) => manifestCollector.addServerFn(fnId, meta)
        : undefined,
    });

    const map = result.map ? JSON.parse(result.map) : undefined;
    callback(null, result.code, map);
  } catch (err) {
    callback(err as Error);
  }
}
