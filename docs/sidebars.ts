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
        "generated-contributions",
        "plugins",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "architecture",
        "core-0.3-rfc",
        "config",
        "qiankun",
        "advanced-conventions",
        "dev",
        "build",
        "deploy",
      ],
    },
    {
      type: "category",
      label: "Migration Compatibility",
      items: ["plugin-migration-0.2-to-0.3"],
    },
    {
      type: "category",
      label: "Community",
      items: ["contributing", "roadmap"],
    },
  ],
};

export default sidebars;
