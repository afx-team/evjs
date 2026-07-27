import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  route: {
    extensions: {
      "@evjs/qiankun": {
        microApp: "catalog",
      },
    },
  },
});
