import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "APAC Operations Snapshot",
  meta: {
    description: "A nested APAC operations snapshot generated as static HTML.",
    "theme-color": "#f8fafc",
  },
  render: "ssg",
});
