import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "evjs Basic",
  meta: {
    description: "The canonical evjs SPA example.",
    keywords: "evjs,spa,server functions",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
});
