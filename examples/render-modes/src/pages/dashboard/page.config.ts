import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Revenue Risk Dashboard | Acme Pay",
  meta: {
    description: "Review revenue risk and payment operations requiring action.",
    "theme-color": "#0f172a",
  },
  render: "ssr",
  hydrate: "load",
});
