import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Build-Time Commerce Report",
  meta: {
    description: "A commerce report rendered as static HTML during ev build.",
    keywords: "evjs,ssg,commerce report",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#f8fafc",
  },
  render: "ssg",
});
