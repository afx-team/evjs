import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";
import styles from "./index.module.css";

type FeatureIconName =
  | "routes"
  | "function"
  | "plugin"
  | "server"
  | "render"
  | "deploy";

type LearningPath = {
  label: string;
  title: string;
  description: string;
  href: string;
};

function useFeatures(): Array<{
  icon: FeatureIconName;
  title: string;
  description: string;
}> {
  return [
    {
      icon: "routes",
      title: translate({
        id: "homepage.feature.pages.title",
        message: "Directories define page URLs",
      }),
      description: translate({
        id: "homepage.feature.pages.description",
        message:
          "Put page.tsx in the directory for its route and keep the page's components, data, and tests nearby.",
      }),
    },
    {
      icon: "render",
      title: translate({
        id: "homepage.feature.rendering.title",
        message: "Render page by page",
      }),
      description: translate({
        id: "homepage.feature.rendering.description",
        message:
          "Start with CSR, then choose SSR, SSG, PPR, or RSC only for pages that need a different delivery model.",
      }),
    },
    {
      icon: "function",
      title: translate({
        id: "homepage.feature.serverFunctions.title",
        message: "Call server functions",
      }),
      description: translate({
        id: "homepage.feature.serverFunctions.description",
        message:
          'Export typed operations from a "use server" module and call them from application code.',
      }),
    },
    {
      icon: "server",
      title: translate({
        id: "homepage.feature.serverRoutes.title",
        message: "Expose web-standard APIs",
      }),
      description: translate({
        id: "homepage.feature.serverRoutes.description",
        message:
          "Create HTTP endpoints with file routes, uppercase methods, and standard Request and Response values.",
      }),
    },
    {
      icon: "plugin",
      title: translate({
        id: "homepage.feature.plugins.title",
        message: "Extend with typed plugins",
      }),
      description: translate({
        id: "homepage.feature.plugins.description",
        message:
          "Configure plugins once for the application and opt pages into their typed behavior where needed.",
      }),
    },
    {
      icon: "deploy",
      title: translate({
        id: "homepage.feature.deployment.title",
        message: "Deploy across runtimes",
      }),
      description: translate({
        id: "homepage.feature.deployment.description",
        message:
          "Deploy browser-only apps as static sites, or target Node.js, edge, and split-origin architectures.",
      }),
    },
  ];
}

function useLearningPaths(): LearningPath[] {
  return [
    {
      label: "01",
      title: translate({
        id: "homepage.flow.source.title",
        message: "Create a project",
      }),
      description: translate({
        id: "homepage.flow.source.description",
        message:
          "Create an app, add your first pages, and navigate between them.",
      }),
      href: "/docs/quick-start",
    },
    {
      label: "02",
      title: translate({
        id: "homepage.flow.discover.title",
        message: "Build page experiences",
      }),
      description: translate({
        id: "homepage.flow.discover.description",
        message: "Add routes, layouts, navigation, and rendering choices.",
      }),
      href: "/docs/client-routes",
    },
    {
      label: "03",
      title: translate({
        id: "homepage.flow.bundle.title",
        message: "Add server features",
      }),
      description: translate({
        id: "homepage.flow.bundle.description",
        message: "Call server functions or expose public HTTP endpoints.",
      }),
      href: "/docs/server-functions",
    },
    {
      label: "04",
      title: translate({
        id: "homepage.flow.output.title",
        message: "Build and deploy",
      }),
      description: translate({
        id: "homepage.flow.output.description",
        message: "Build for production and choose a deployment target.",
      }),
      href: "/docs/deploy",
    },
  ];
}

function HeroSection() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroLayout}>
        <div className={styles.heroContent}>
          <div className={styles.eyebrow}>
            <Translate id="homepage.eyebrow">
              React full-stack framework
            </Translate>
          </div>
          <h1 className={styles.heroTitle}>evjs</h1>
          <p className={styles.heroSubtitle}>
            <Translate id="homepage.tagline">
              Build around pages, not framework plumbing
            </Translate>
          </p>
          <p className={styles.heroDescription}>
            <Translate id="homepage.hero.description">
              File-based pages, optional server code, per-page rendering, and
              deployable output in one predictable application model.
            </Translate>
          </p>
          <div className={styles.heroButtons}>
            <Link className={styles.btnPrimary} to="/docs/quick-start">
              <Translate id="homepage.getStarted">Start building</Translate>
              <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.btnSecondary} to="/docs/architecture">
              <Translate id="homepage.readDesign">Read the design</Translate>
            </Link>
          </div>
        </div>

        <section className={styles.codePreview} aria-label="evjs page example">
          <div className={styles.codePreviewHeader}>
            <span />
            <span />
            <span />
            <strong>src/pages</strong>
          </div>
          <pre className={styles.codePreviewBody}>
            <code>{`pages/
├── page.tsx                 # /
└── products/
    └── $productId/
        ├── page.tsx         # /products/:productId
        ├── page.config.ts
        └── get-product.server.ts

// page.tsx
export default function ProductPage() {
  return <Product />;
}`}</code>
          </pre>
        </section>
      </div>
    </header>
  );
}

function LearningPaths() {
  const paths = useLearningPaths();
  return (
    <section className={styles.workflowSection}>
      <div className={styles.workflowContainer}>
        <div className={styles.workflowIntro}>
          <div className={styles.sectionLabel}>
            <Translate id="homepage.workflow.label">Start here</Translate>
          </div>
          <h2 className={styles.workflowTitle}>
            <Translate id="homepage.workflow.title">
              Learn one task at a time
            </Translate>
          </h2>
          <p className={styles.workflowDescription}>
            <Translate id="homepage.workflow.description">
              Start small and open the guide that matches what you want to add.
            </Translate>
          </p>
        </div>
        <div className={styles.flowGrid}>
          {paths.map((path) => (
            <Link key={path.label} className={styles.flowStep} to={path.href}>
              <span className={styles.flowLabel}>{path.label}</span>
              <h3 className={styles.flowTitle}>{path.title}</h3>
              <p className={styles.flowDescription}>{path.description}</p>
              <span className={styles.flowArrow} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = useFeatures();
  return (
    <section className={styles.features}>
      <div className={styles.featuresContainer}>
        <div className={styles.featuresHeading}>
          <div className={styles.sectionLabel}>
            <Translate id="homepage.features.label">Framework design</Translate>
          </div>
          <h2 className={styles.featuresTitle}>
            <Translate id="homepage.features.title">
              Core concepts that grow with your application
            </Translate>
          </h2>
        </div>
        <div className={styles.featuresGrid}>
          {features.map((feature) => (
            <div key={feature.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <FeatureIcon name={feature.icon} />
              </div>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureDesc}>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureIcon({ name }: { name: FeatureIconName }) {
  const paths: Record<FeatureIconName, ReactNode> = {
    routes: (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6H14a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h5.5" />
      </>
    ),
    plugin: (
      <>
        <path d="M8 3v5H3" />
        <path d="M16 3v5h5" />
        <path d="M8 21v-5H3" />
        <path d="M16 21v-5h5" />
        <path d="M8 8h8v8H8z" />
      </>
    ),
    server: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="2" />
        <rect x="4" y="14" width="16" height="6" rx="2" />
        <path d="M8 7h.01M8 17h.01M12 7h4M12 17h4" />
      </>
    ),
    function: (
      <>
        <path d="M8 7c0-2 1.5-4 4-4h2" />
        <path d="M6 11h8" />
        <path d="M7 21h1c2.5 0 4-2 4-4V7" />
        <path d="m16 13 2 2 2-2" />
        <path d="m16 19 2-2 2 2" />
      </>
    ),
    render: (
      <>
        <path d="M4 7h16" />
        <path d="M4 17h16" />
        <path d="M7 4v16" />
        <path d="M17 4v16" />
        <path d="m10 10 4 2-4 2v-4Z" />
      </>
    ),
    deploy: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
        <path d="M7 17h10" />
      </>
    ),
  };

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HeroSection />
      <main>
        <LearningPaths />
        <FeaturesSection />
      </main>
    </Layout>
  );
}
