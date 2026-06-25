import type { ReactNode } from "react";

export default function Root({ children }: { children?: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Route Handlers Example</h1>
      <p style={{ color: "#666" }}>
        REST endpoints discovered from <code>src/apis</code>
      </p>
      {children}
    </div>
  );
}
