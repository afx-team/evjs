import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "evjs",
  tagline: "A React framework built around pages, server code, and conventions",
  favicon: "img/favicon.ico",

  url: "https://afx-team.github.io",
  baseUrl: "/evjs/",

  organizationName: "afx-team",
  projectName: "evjs",

  onBrokenLinks: "throw",

  future: {
    faster: {
      swcJsLoader: true,
      swcJsMinimizer: true,
      swcHtmlMinimizer: true,
      lightningCssMinimizer: true,
      rspackBundler: true,
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-Hans"],
    localeConfigs: {
      en: { label: "English" },
      "zh-Hans": { label: "简体中文" },
    },
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  themes: ["@docusaurus/theme-mermaid"],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/afx-team/evjs/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "evjs",
      items: [
        {
          type: "docSidebar",
          sidebarId: "guideSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/docs/guides",
          label: "Guides",
          position: "left",
        },
        {
          to: "/docs/config",
          label: "Configuration",
          position: "left",
        },
        {
          href: "https://www.npmjs.com/package/@evjs/cli",
          label: "npm",
          position: "right",
        },
        {
          href: "https://github.com/afx-team/evjs",
          label: "GitHub",
          position: "right",
        },
        {
          type: "localeDropdown",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Learn",
          items: [
            { label: "Quick Start", to: "/docs/quick-start" },
            { label: "Pages and Routing", to: "/docs/client-routes" },
            { label: "Rendering", to: "/docs/rendering" },
          ],
        },
        {
          title: "Reference",
          items: [
            { label: "Configuration", to: "/docs/config" },
            { label: "File Conventions", to: "/docs/file-conventions" },
            { label: "Deployment", to: "/docs/deploy" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: "https://github.com/afx-team/evjs" },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/@evjs/cli",
            },
            { label: "Contributing", to: "/docs/contributing" },
          ],
        },
      ],
      copyright:
        'Copyright (c) 2015-present <a href="https://xtech.antfin.com/" target="_blank" rel="noopener noreferrer">Ant UED</a>',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
