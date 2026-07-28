import type { ReactNode } from "react";

export function RouteCard({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "1rem",
      }}
    >
      {children}
    </div>
  );
}
