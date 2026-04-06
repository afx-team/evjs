import { createRootRoute, Outlet } from "@evjs/client";

function Root() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "800px",
        margin: "0 auto",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid #eee",
          marginBottom: "2rem",
          paddingBottom: "1rem",
        }}
      >
        <h1 style={{ margin: 0 }}>@evjs + tRPC</h1>
        <p style={{ color: "#666" }}>
          Combining Zero-Config Server Functions with tRPC Type-Safety
        </p>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export const rootRoute = createRootRoute({ component: Root });
