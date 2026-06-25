import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist",
    server: "dist-server",
  },
  html: "./index.html",
  routing: {
    mode: "mpa",
  },
});
