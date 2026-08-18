import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guideSidebar: [
    "overview",
    {
      type: "category",
      label: "Getting Started",
      link: {
        type: "doc",
        id: "getting-started",
      },
      items: ["quick-start", "project-structure"],
    },
    {
      type: "category",
      label: "Guides",
      link: {
        type: "doc",
        id: "guides",
      },
      items: [
        "client-routes",
        "rendering",
        "server-functions",
        "server-routes",
        "plugins",
        "dev",
        "build",
        "deploy",
        "qiankun",
      ],
    },
    {
      type: "category",
      label: "Framework Design",
      items: ["architecture", "file-conventions"],
    },
    {
      type: "category",
      label: "Reference",
      link: {
        type: "doc",
        id: "reference",
      },
      items: ["config", "advanced-conventions"],
    },
    {
      type: "category",
      label: "Plugin Development",
      collapsed: true,
      link: {
        type: "doc",
        id: "plugin-authoring",
      },
      items: ["plugin-hooks", "generated-contributions", "plugin-recipes"],
    },
    {
      type: "category",
      label: "Project",
      collapsed: true,
      items: ["contributing", "roadmap"],
    },
  ],
};

export default sidebars;
