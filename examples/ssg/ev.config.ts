import { webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  bundler: webpackAdapter,
});
