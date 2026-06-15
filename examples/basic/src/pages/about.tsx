const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "1rem",
};

export default function AboutPage() {
  return (
    <div style={cardStyle}>
      <h2>Static Route</h2>
      <p>
        This page is discovered from <code>src/pages/about.tsx</code> and served
        at <code>/about</code>.
      </p>
    </div>
  );
}
