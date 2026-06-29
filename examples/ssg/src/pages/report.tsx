export const render = "ssg";

const metrics = [
  ["Orders", "12,480"],
  ["Conversion", "8.4%"],
  ["Revenue", "$384K"],
];

export default function Report() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        color: "#172033",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          color: "#64748b",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Static generation
      </p>
      <h1 style={{ margin: "0 0 12px", fontSize: 40, lineHeight: 1.1 }}>
        Build-Time Commerce Report
      </h1>
      <p style={{ margin: "0 0 28px", color: "#475569", fontSize: 17 }}>
        This page is rendered during <code>ev build</code> and emitted as an
        HTML document that can be served without the framework server.
      </p>
      <section
        aria-label="SSG metrics"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        {metrics.map(([label, value]) => (
          <article
            key={label}
            style={{
              border: "1px solid #d8deea",
              borderRadius: 8,
              background: "#fff",
              padding: 16,
            }}
          >
            <span style={{ color: "#64748b", fontSize: 13 }}>{label}</span>
            <strong
              data-testid={`metric-${label.toLowerCase()}`}
              style={{ display: "block", marginTop: 6, fontSize: 24 }}
            >
              {value}
            </strong>
          </article>
        ))}
      </section>
    </main>
  );
}
