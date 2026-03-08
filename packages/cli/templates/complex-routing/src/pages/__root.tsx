import { createAppRootRoute, Link, Outlet } from "@evjs/runtime/client";

const styles = {
  app: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 900,
    margin: "0 auto",
    padding: "1rem",
  },
  nav: {
    display: "flex",
    gap: "1rem",
    padding: "0.75rem 0",
    borderBottom: "1px solid #e5e7eb",
    marginBottom: "1rem",
  },
  link: { textDecoration: "none", color: "#6b7280" },
  activeLink: { color: "#111", fontWeight: 600 as const },
};

function RootLayout() {
  return (
    <div style={styles.app}>
      <nav style={styles.nav}>
        <Link
          to="/"
          style={styles.link}
          activeProps={{ style: styles.activeLink }}
        >
          Home
        </Link>
        <Link
          to="/posts"
          style={styles.link}
          activeProps={{ style: styles.activeLink }}
        >
          Posts
        </Link>
        <Link
          to="/dashboard"
          style={styles.link}
          activeProps={{ style: styles.activeLink }}
        >
          Dashboard
        </Link>
        <Link
          to="/search"
          search={{ q: "" }}
          style={styles.link}
          activeProps={{ style: styles.activeLink }}
        >
          Search
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createAppRootRoute({ component: RootLayout });
