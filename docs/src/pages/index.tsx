import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";
import styles from "./index.module.css";

/* ─── Feature data ─── */

type FeatureIconName =
  | "routes"
  | "function"
  | "plugin"
  | "server"
  | "render"
  | "deploy";

type FlowStep = {
  label: string;
  title: string;
  description: string;
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
        message: "Page Routes",
      }),
      description: translate({
        id: "homepage.feature.pages.description",
        message:
          "Build SPA or MPA pages from src/pages without writing router bootstrap code.",
      }),
    },
    {
      icon: "server",
      title: translate({
        id: "homepage.feature.serverRoutes.title",
        message: "Server Routes",
      }),
      description: translate({
        id: "homepage.feature.serverRoutes.description",
        message:
          "Expose Request and Response handlers with positive src/apis/**/api.* anchors and uppercase HTTP method exports.",
      }),
    },
    {
      icon: "function",
      title: translate({
        id: "homepage.feature.serverFunctions.title",
        message: "Server Functions",
      }),
      description: translate({
        id: "homepage.feature.serverFunctions.description",
        message:
          'Call reachable "use server" functions from browser code through the built-in transport.',
      }),
    },
    {
      icon: "render",
      title: translate({
        id: "homepage.feature.rendering.title",
        message: "Rendering Modes",
      }),
      description: translate({
        id: "homepage.feature.rendering.description",
        message:
          "Configure CSR, SSR, SSG, PPR, and RSC through adjacent page.config.ts files.",
      }),
    },
    {
      icon: "plugin",
      title: translate({
        id: "homepage.feature.plugins.title",
        message: "Plugins",
      }),
      description: translate({
        id: "homepage.feature.plugins.description",
        message:
          "Extend config, bundler setup, HTML transforms, build output, and generated framework code.",
      }),
    },
    {
      icon: "deploy",
      title: translate({
        id: "homepage.feature.deployment.title",
        message: "Deployment Output",
      }),
      description: translate({
        id: "homepage.feature.deployment.description",
        message:
          "Emit browser assets, optional server bundles, manifests, and deployment metadata.",
      }),
    },
  ];
}

function useFlowSteps(): FlowStep[] {
  return [
    {
      label: "01",
      title: translate({
        id: "homepage.flow.source.title",
        message: "Author files",
      }),
      description: translate({
        id: "homepage.flow.source.description",
        message:
          "Write pages, routes, middleware, server functions, and ev.config.ts.",
      }),
    },
    {
      label: "02",
      title: translate({
        id: "homepage.flow.discover.title",
        message: "Discover conventions",
      }),
      description: translate({
        id: "homepage.flow.discover.description",
        message:
          "Resolve page routes, server routes, middleware, and rendering metadata.",
      }),
    },
    {
      label: "03",
      title: translate({
        id: "homepage.flow.bundle.title",
        message: "Bundle once",
      }),
      description: translate({
        id: "homepage.flow.bundle.description",
        message:
          "Use the selected bundler adapter to build browser and server entries.",
      }),
    },
    {
      label: "04",
      title: translate({
        id: "homepage.flow.output.title",
        message: "Deploy",
      }),
      description: translate({
        id: "homepage.flow.output.description",
        message:
          "Write browser files, server output, manifests, and deployment metadata.",
      }),
    },
  ];
}

/* ─── Hero ─── */

function HeroSection() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroContent}>
        <h1 className={styles.heroTitle}>evjs</h1>
        <p className={styles.heroSubtitle}>
          <Translate id="homepage.tagline">
            React framework for file-based pages and server code
          </Translate>
        </p>
        <p className={styles.heroDescription}>
          <Translate id="homepage.hero.description">
            Use page.* anchors under src/pages for page routes, api.* anchors
            under src/apis for server routes, and "use server" modules for
            server functions. Start with conventions and add configuration only
            when the defaults are not enough.
          </Translate>
        </p>
        <div className={styles.heroButtons}>
          <Link className={styles.btnPrimary} to="/docs/quick-start">
            <Translate id="homepage.getStarted">Get Started</Translate>
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            className={styles.btnSecondary}
            href="https://github.com/evaijs/evjs"
          >
            <GitHubIcon />
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ─── Build Flow Preview ─── */

function BuildFlowPreview() {
  const steps = useFlowSteps();
  return (
    <section className={styles.workflowSection}>
      <div className={styles.workflowContainer}>
        <div className={styles.workflowIntro}>
          <div className={styles.featuresLabel}>
            <Translate id="homepage.workflow.label">Build Flow</Translate>
          </div>
          <h2 className={styles.workflowTitle}>
            <Translate id="homepage.workflow.title">
              From files to deployable output
            </Translate>
          </h2>
          <p className={styles.workflowDescription}>
            <Translate id="homepage.workflow.description">
              evjs keeps the common path small: discover conventions, build the
              app, then emit browser and server artifacts for deployment.
            </Translate>
          </p>
        </div>
        <div className={styles.flowGrid}>
          {steps.map((step) => (
            <div key={step.label} className={styles.flowStep}>
              <span className={styles.flowLabel}>{step.label}</span>
              <h3 className={styles.flowTitle}>{step.title}</h3>
              <p className={styles.flowDescription}>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Features ─── */

function FeaturesSection() {
  const features = useFeatures();
  return (
    <section className={styles.features}>
      <div className={styles.featuresContainer}>
        <div className={styles.featuresHeading}>
          <div className={styles.featuresLabel}>
            <Translate id="homepage.features.label">
              What evjs handles
            </Translate>
          </div>
          <h2 className={styles.featuresTitle}>
            <Translate id="homepage.features.title">
              File routes, server code, and build output
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

/* ─── Icons ─── */

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

function GitHubIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <title>GitHub</title>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ─── Page ─── */

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HeroSection />
      <BuildFlowPreview />
      <main>
        <FeaturesSection />
      </main>
    </Layout>
  );
}
