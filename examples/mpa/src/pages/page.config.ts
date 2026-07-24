import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "evjs MPA Home",
  meta: {
    description: "The home Page in the canonical evjs MPA example.",
    keywords: "evjs,mpa,home",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
});
