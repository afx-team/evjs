import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "mpa" },
  output: {
    client: "dist",
    server: "dist-server",
  },
});
