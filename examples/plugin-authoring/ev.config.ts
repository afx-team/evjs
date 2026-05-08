import { utoopack } from "@evjs/bundler-utoopack";
import { defineConfig } from "@evjs/ev";

/**
 * Example: evjs plugin system.
 *
 * Demonstrates all available plugin hooks:
 * - `config`         — update framework config before defaults are resolved
 * - `bundlerConfig` — modify the underlying bundler config (type-safe via utoopack() helper)
 * - `buildStart`    — run logic before compilation begins
 * - `buildEnd`      — run logic after compilation completes
 * - `transformHtml` — modify the output HTML document after asset injection
 */
export default defineConfig({
  plugins: [
    {
      name: "example-txt-plugin",
      config(config) {
        config.server = {
          ...(typeof config.server === "object" ? config.server : {}),
          endpoint: "/api/rpc",
        };
        return config;
      },
      setup(ctx) {
        console.log(`[example-txt-plugin] mode: ${ctx.mode}`);

        return {
          buildStart() {
            console.log("[example-txt-plugin] build starting...");
          },

          // Type-safe bundler config mutation via the utoopack helper.
          // This hook only runs when utoopack is the active bundler.
          bundlerConfig(config, ctx) {
            utoopack((cfg) => {
              // Add custom loaders or rules to utoopack
              cfg.module ??= {};
              cfg.module.rules ??= {};
              cfg.module.rules[".txt"] = { type: "raw" };
            })(config, ctx);
          },

          buildEnd(result) {
            console.log(
              `[example-txt-plugin] build complete — ${result.clientManifest.assets.js.length} JS asset(s)`,
            );
          },

          // Modify the parsed HTML document after evjs injects script/link tags
          transformHtml(doc, result) {
            const assetCount =
              result.clientManifest.assets.js.length +
              result.clientManifest.assets.css.length;

            const comment = doc.createComment(
              ` Built with evjs | ${assetCount} asset(s) `,
            );
            doc.head?.appendChild(comment);
          },
        };
      },
    },
  ],
});
