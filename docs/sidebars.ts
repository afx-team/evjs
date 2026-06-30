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
        "project-structure",
        "file-conventions",
        "client-routes",
        "server-functions",
        "server-routes",
        "plugins",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "architecture",
        "config",
        "advanced-conventions",
        "dev",
        "build",
        "deploy",
      ],
    },
    {
      type: "category",
      label: "Community",
      items: ["contributing", "roadmap"],
    },
  ],
};

export default sidebars;
