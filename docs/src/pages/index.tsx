import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

/* ─── Feature data ─── */

function useFeatures() {
  return [
    {
      icon: "⚡",
      title: translate({
        id: "homepage.feature.zeroConfig.title",
        message: "Zero Config",
      }),
      description: translate({
        id: "homepage.feature.zeroConfig.description",
        message:
          "ev dev / ev build — no boilerplate needed. Convention over configuration with optional ev.config.ts.",
      }),
    },
    {
      icon: "🔒",
      title: translate({
        id: "homepage.feature.clientRoutes.title",
        message: "Client Routes",
      }),
      description: translate({
        id: "homepage.feature.clientRoutes.description",
        message:
          "Full end-to-end type safety from server to browser URL bar, powered by TanStack Router.",
      }),
    },
    {
      icon: "🛣️",
      title: translate({
        id: "homepage.feature.serverRoutes.title",
        message: "Server Routes",
      }),
      description: translate({
        id: "homepage.feature.serverRoutes.description",
        message:
          "Standard Request/Response REST endpoints via route() — build APIs alongside your React app.",
      }),
    },
    {
      icon: "🚀",
      title: translate({
        id: "homepage.feature.serverFn.title",
        message: "Server Functions",
      }),
      description: translate({
        id: "homepage.feature.serverFn.description",
        message:
          '"use server" directive auto-transforms async functions into type-safe API calls at build time.',
      }),
    },
    {
      icon: "📡",
      title: translate({
        id: "homepage.feature.dataFetching.title",
        message: "Data Fetching",
      }),
      description: translate({
        id: "homepage.feature.dataFetching.description",
        message:
          "TanStack Query with built-in proxies — query(fn).useQuery() / mutation(fn).useMutation(), zero boilerplate.",
      }),
    },
    {
      icon: "🌐",
      title: translate({
        id: "homepage.feature.multiRuntime.title",
        message: "Multi-Runtime",
      }),
      description: translate({
        id: "homepage.feature.multiRuntime.description",
        message:
          "Hono-based server runs on Node.js, Deno, Bun, and edge runtimes out of the box.",
      }),
    },
  ];
}

/* ─── Hero ─── */

function HeroSection() {
  return (
    <header className={styles.hero}>
      {/* Animated grid */}
      <div className={styles.heroGrid} />
      {/* Floating glow orbs */}
      <div className={styles.heroGlow} />

      <div className={styles.heroContent}>
        <h1 className={styles.heroTitle}>evjs</h1>
        <p className={styles.heroSubtitle}>
          <Translate id="homepage.tagline">
            React fullstack framework built on TanStack + Hono
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

/* ─── Terminal Code Preview ─── */

function TerminalPreview() {
  return (
    <div className={styles.terminalSection}>
      <div className={styles.terminal}>
        <div className={styles.terminalHeader}>
          <span className={`${styles.terminalDot} ${styles.terminalDotRed}`} />
          <span
            className={`${styles.terminalDot} ${styles.terminalDotYellow}`}
          />
          <span
            className={`${styles.terminalDot} ${styles.terminalDotGreen}`}
          />
        </div>
        <div className={styles.terminalBody}>
          <div>
            <span className={styles.terminalComment}>
              # Create a new evjs app
            </span>
          </div>
          <div>
            <span className={styles.terminalPrompt}>$ </span>
            <span className={styles.terminalCmd}>npx</span>{" "}
            <span className={styles.terminalArg}>@evjs/create-app</span> my-app
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <span className={styles.terminalComment}># Start developing</span>
          </div>
          <div>
            <span className={styles.terminalPrompt}>$ </span>
            <span className={styles.terminalCmd}>cd</span> my-app &&{" "}
            <span className={styles.terminalCmd}>npm run</span>{" "}
            <span className={styles.terminalArg}>dev</span>
            <span className={styles.terminalCursor} />
          </div>
        </div>
      </div>
    </div>
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
            <Translate id="homepage.features.label">Features</Translate>
          </div>
          <h2 className={styles.featuresTitle}>
            <Translate id="homepage.features.title">
              Everything you need to build full-stack React apps
            </Translate>
          </h2>
        </div>
        <div className={styles.featuresGrid}>
          {features.map((feature) => (
            <div key={feature.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{feature.icon}</div>
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
      <TerminalPreview />
      <main>
        <FeaturesSection />
      </main>
    </Layout>
  );
}
