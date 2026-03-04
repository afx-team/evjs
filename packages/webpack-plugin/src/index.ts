import type { Compiler } from "webpack";

interface ServerFnMetadata {
  file: string;
  name: string;
}

class ManifestCollector {
  serverFns: Record<string, ServerFnMetadata> = {};

  addServerFn(id: string, meta: ServerFnMetadata) {
    this.serverFns[id] = meta;
  }

  getManifest() {
    return {
      serverFns: this.serverFns,
    };
  }
}

export class EvWebpackPlugin {
  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    (compiler as any)._ev_manifest_collector = collector;

    compiler.hooks.emit.tap("EvWebpackPlugin", (compilation) => {
      const manifest = collector.getManifest();
      if (Object.keys(manifest.serverFns).length === 0) {
        return;
      }
      const content = JSON.stringify(manifest, null, 2);

      compilation.assets["ev-manifest.json"] = {
        source: () => content,
        size: () => content.length,
      } as any;
    });
  }
}
