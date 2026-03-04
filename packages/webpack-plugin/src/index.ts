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

export class EvaiWebpackPlugin {
  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    (compiler as any)._evai_manifest_collector = collector;

    compiler.hooks.emit.tap("EvaiWebpackPlugin", (compilation) => {
      const manifest = collector.getManifest();
      const content = JSON.stringify(manifest, null, 2);

      compilation.assets["evai-manifest.json"] = {
        source: () => content,
        size: () => content.length,
      } as any;
    });
  }
}
