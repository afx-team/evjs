import { defineConfig } from "@evjs/ev";

export default defineConfig({
  ssr: true,
  server: {
    entry: "./src/server.tsx",
  },
});
