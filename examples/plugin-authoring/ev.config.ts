import { merge, utoopack } from "@evjs/bundler-utoopack";
import { defineConfig } from "@evjs/ev";
import {
  definePlugin,
  definePluginPreset,
  pluginOptions,
} from "@evjs/ev/plugin";

type ApplicationMetadata = {
  channel: string;
};

type PageMetadata = {
  label: string;
};

const metadataPlugin = definePlugin({
  name: "@example/metadata",
  key: "metadata",
  application: pluginOptions<ApplicationMetadata>({ schemaVersion: "1" }),
  page: pluginOptions<PageMetadata>({
    schemaVersion: "1",
    defaults: { label: "Plugin authoring Page" },
  }),
  setup(ctx) {
    const metadata = ctx.options;
    console.log(
      `[example-metadata-plugin] Application value: ${JSON.stringify(metadata)}`,
    );
  },
  emitIR(ctx) {
    for (const { page, options } of ctx.pages) {
      console.log(
        `[example-metadata-plugin] Page ${page.id}: ${JSON.stringify(options)}`,
      );
    }
  },
});

const txtPlugin = definePlugin({
  name: "@example/txt",
  configure(config) {
    config.server = {
      ...(typeof config.server === "object" ? config.server : {}),
      basePath: "/api",
    };
    return config;
  },
  setup(ctx) {
    console.log(`[example-txt-plugin] mode: ${ctx.mode}`);

    return {
      beforeBuild() {
        console.log("[example-txt-plugin] framework output starting...");
      },

      // Type-safe bundler config mutation via the utoopack helper.
      // This hook only runs when utoopack is the active bundler.
      configureBundler: utoopack((cfg) => {
        // Add custom loaders or rules to utoopack
        merge(cfg, {
          module: { rules: { ".txt": { type: "raw" } } },
        });
      }),

      afterBuild(result) {
        const appAssets = Object.values(result.output.apps);
        const pageAssets = Object.values(result.output.pages);
        const jsCount = [...appAssets, ...pageAssets].reduce(
          (count, entry) => count + entry.assets.js.length,
          0,
        );
        console.log(
          `[example-txt-plugin] build complete — ${jsCount} JS asset(s)`,
        );
      },

      // Modify the parsed HTML document after evjs injects script/link tags
      transformHtml(doc, ctx) {
        const assetCount = ctx.assets.js.length + ctx.assets.css.length;

        const comment = doc.createComment(
          ` Built with evjs | ${ctx.fileName} | ${assetCount} asset(s) `,
        );
        doc.head?.appendChild(comment);
      },
    };
  },
});

const examplePlugins = definePluginPreset((metadata: ApplicationMetadata) => [
  metadataPlugin(metadata).when(
    process.env.EXAMPLE_METADATA !== "off",
    "EXAMPLE_METADATA is set to off",
  ),
  txtPlugin(),
]);

/**
 * Example: evjs plugin system.
 *
 * Demonstrates common lifecycle hooks:
 * - `configure`        — update framework config before defaults are resolved
 * - `configureBundler` — modify the underlying bundler config (type-safe via utoopack() helper)
 * - `beforeBuild`      — start one framework output/link cycle from fresh bundler facts
 * - `afterBuild`       — run logic after the framework output stabilizes
 * - `transformHtml` — modify the output HTML document after asset injection
 */
export default defineConfig({
  routing: { mode: "spa" },
  plugins: [examplePlugins({ channel: "web" })],
});
