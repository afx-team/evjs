import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  extensions: {
    "@example/page-metadata": {
      label: "Configured by page.config.ts",
    },
  },
});
