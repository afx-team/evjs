import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guideSidebar: [
    {
      type: "category",
      label: "Introduction",
      items: ["overview", "quick-start"],
    },
    {
      type: "category",
      label: "Core Concepts",
      items: [
        "architecture",
        "project-structure",
        "client-routes",
        "server-functions",
        "server-routes",
        "plugins",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: ["config", "dev", "build", "deploy"],
    },
    {
      type: "category",
      label: "Community",
      items: ["contributing", "roadmap"],
    },
  ],
};

export default sidebars;
