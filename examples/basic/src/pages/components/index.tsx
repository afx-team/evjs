export default function PageScopeNote() {
  return (
    <p style={{ color: "#475569", marginBottom: 0 }}>
      This nested components/index.tsx is ordinary code in the root Page scope;
      only page.tsx creates a Page route.
    </p>
  );
}
