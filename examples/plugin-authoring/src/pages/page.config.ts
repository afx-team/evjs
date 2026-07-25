import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  extensions: {
    "@example/metadata": {
      label: "Configured by page.config.ts",
    },
  },
  route: {
    extensions: {
      "@example/metadata": {
        label: "Configured for the home Route",
      },
    },
  },
});
