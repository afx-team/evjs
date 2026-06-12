import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: false,
  html: "./index.html",
  fileRoutes: {
    mode: "mpa",
  },
});
