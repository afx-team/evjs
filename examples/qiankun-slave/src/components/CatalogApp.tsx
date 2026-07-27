import "../styles.css";

export function CatalogApp() {
  return (
    <main className="catalog">
      <p className="eyebrow">qiankun slave</p>
      <h1>Catalog</h1>
      <div className="grid">
        <article>
          <strong>Orders</strong>
          <span>142 pending</span>
        </article>
        <article>
          <strong>Inventory</strong>
          <span>32 updates</span>
        </article>
        <article>
          <strong>Revenue</strong>
          <span>$18.4k today</span>
        </article>
      </div>
    </main>
  );
}
