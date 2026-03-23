import { createRoute, Outlet, useQuery } from "@evjs/client";
import { getStats } from "../api/data.server";
import { rootRoute } from "./__root";

const styles = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1rem",
    marginBottom: "0.75rem",
  },
  stat: { textAlign: "center" as const, padding: "1rem" },
  tag: {
    display: "inline-block",
    background: "#f3f4f6",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    marginRight: 4,
  },
};

// ── Pathless layout (no URL segment, just shared UI) ──

export const dashboardLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "dashboard-layout",
  component: () => (
    <div>
      <Outlet />
    </div>
  ),
});

// ── Dashboard page (/dashboard) ──

function Dashboard() {
  const { data: stats } = useQuery(getStats);
  if (!stats) return <p>Loading...</p>;
  return (
    <div>
      <h2>Dashboard</h2>
      <div style={{ display: "flex", gap: "1rem" }}>
        <div style={{ ...styles.card, ...styles.stat }}>
          <div style={{ fontSize: 32, fontWeight: 700 }}>
            {stats.totalPosts}
          </div>
          <div style={{ color: "#6b7280" }}>Posts</div>
        </div>
        <div style={{ ...styles.card, ...styles.stat }}>
          <div style={{ fontSize: 32, fontWeight: 700 }}>
            {stats.totalUsers}
          </div>
          <div style={{ color: "#6b7280" }}>Users</div>
        </div>
        <div style={{ ...styles.card, ...styles.stat }}>
          <div style={{ fontSize: 32, fontWeight: 700 }}>
            {stats.tags.length}
          </div>
          <div style={{ color: "#6b7280" }}>Tags</div>
        </div>
      </div>
      <h3>All Tags</h3>
      <div>
        {stats.tags.map((t) => (
          <span key={t} style={styles.tag}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export const dashboardRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/dashboard",
  component: Dashboard,
});
