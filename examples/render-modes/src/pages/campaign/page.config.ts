import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: {
    partial: true,
    delivery: "stream",
  },
});
