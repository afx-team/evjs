import type { ReactNode } from "react";

export default function Root({ children }: { children?: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      {children}
    </div>
  );
}
