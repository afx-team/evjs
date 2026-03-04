import { createRootRoute, Link, Outlet } from "@evai/runtime/client";

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <nav
        style={{
          display: "flex",
          gap: "1rem",
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <Link to="/" style={{ fontWeight: "bold" }}>
          Home
        </Link>
        <Link to="/about">About</Link>
        <Link to="/posts">Posts</Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: Root,
});
