import { webpack } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";

/**
 * Example: evjs plugin system.
 *
 * Demonstrates all available plugin hooks:
 * - `bundler`       — modify the underlying bundler config (type-safe via helpers)
 * - `buildStart`    — run logic before compilation begins
 * - `buildEnd`      — run logic after compilation completes
 * - `transformHtml` — modify the output HTML document after asset injection
 */
export default defineConfig({
  server: false,

  plugins: [
    {
      name: "example-txt-plugin",
      setup(ctx) {
        console.log(`[example-txt-plugin] mode: ${ctx.mode}`);

        return {
          buildStart() {
            console.log("[example-txt-plugin] build starting...");
          },

          // Type-safe webpack config mutation via the webpack() helper
          bundler: webpack((config) => {
            config.module?.rules?.push({
              test: /\.txt$/,
              use: "raw-loader",
            });
          }),

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
