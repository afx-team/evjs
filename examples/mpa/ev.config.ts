import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist",
  },
  html: "./index.html",
  routing: {
    mode: "mpa",
  },
});
