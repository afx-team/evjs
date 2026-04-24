import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: false,
  html: "./index.html",
  pages: {
    home: {
      entry: "./src/home/main.tsx",
    },
    about: {
      entry: "./src/about/main.tsx",
    },
  },
});
