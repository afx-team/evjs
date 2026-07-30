import "../../styles.css";

export default function CatalogDetailsPage() {
  return (
    <main className="catalog">
      <p className="eyebrow">qiankun slave</p>
      <h1>Catalog details</h1>
      <p>This local `/details` Page is mounted at `/catalog/details`.</p>
      <a href="..">Back to catalog</a>
    </main>
  );
}
