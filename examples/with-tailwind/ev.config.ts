import { defineConfig } from "@evjs/cli";

/**
 * Example: Using client plugins to add Tailwind CSS support.
 */
export default defineConfig({
  client: {
    plugins: [
      {
        name: "tailwind",
        module: {
          rules: [
            {
              test: /\.css$/,
              use: ["style-loader", "css-loader", "postcss-loader"],
            },
          ],
        },
      },
    ],
  },
});
