export const render = "ssg";

const forecast = [
  ["North America", "$142K", "+12%"],
  ["Europe", "$96K", "+7%"],
  ["Asia Pacific", "$118K", "+18%"],
];

export default function Forecast() {
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
        Build-Time Revenue Forecast
      </h1>
      <p style={{ margin: "0 0 28px", color: "#475569", fontSize: 17 }}>
        This forecast is rendered once during <code>ev build</code> and shipped
        as a standalone HTML document.
      </p>
      <section
        aria-label="Forecast by region"
        style={{
          display: "grid",
          gap: 12,
        }}
      >
        {forecast.map(([region, value, growth]) => (
          <article
            key={region}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 16,
              alignItems: "center",
              border: "1px solid #d8deea",
              borderRadius: 8,
              background: "#fff",
              padding: 16,
            }}
          >
            <strong>{region}</strong>
            <span
              data-testid={`forecast-${region.toLowerCase().replaceAll(" ", "-")}`}
            >
              {value}
            </span>
            <span style={{ color: "#0f766e", fontWeight: 700 }}>{growth}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
