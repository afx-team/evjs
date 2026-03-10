import { defineConfig } from "@evjs/cli";

export default defineConfig({
  mode: "serverOnly",
  server: {
    endpoint: "/api/fn",
  },
});
