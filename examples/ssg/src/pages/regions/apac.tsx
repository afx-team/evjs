export const render = "ssg";

const regions = [
  ["Singapore", "3,120"],
  ["Tokyo", "4,860"],
  ["Sydney", "2,740"],
];

export default function ApacRegion() {
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
        APAC Operations Snapshot
      </h1>
      <p style={{ margin: "0 0 28px", color: "#475569", fontSize: 17 }}>
        Nested SSG routes are emitted as independent static HTML documents
        without creating a framework server bundle.
      </p>
      <section
        aria-label="APAC city orders"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {regions.map(([city, orders]) => (
          <article
            key={city}
            style={{
              border: "1px solid #d8deea",
              borderRadius: 8,
              background: "#fff",
              padding: 16,
            }}
          >
            <span style={{ color: "#64748b", fontSize: 13 }}>{city}</span>
            <strong
              data-testid={`orders-${city.toLowerCase()}`}
              style={{ display: "block", marginTop: 6, fontSize: 24 }}
            >
              {orders}
            </strong>
          </article>
        ))}
      </section>
    </main>
  );
}
