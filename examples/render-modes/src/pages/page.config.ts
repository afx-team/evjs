import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Acme Pay Control Center",
  meta: {
    description: "Monitor payment operations, risk, and settlement readiness.",
    keywords: "payments,operations,risk",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#0f172a",
  },
  render: "csr",
});
