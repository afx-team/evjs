import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Settlement Readiness Report | Acme Pay",
  meta: {
    description: "A prerendered report of settlement readiness by region.",
    "theme-color": "#0f172a",
  },
  render: "ssr",
  hydrate: "none",
  prerender: true,
});
