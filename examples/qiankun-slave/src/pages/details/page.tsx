import { Link } from "@evjs/ev/navigation";
import "../../styles.css";

export default function CatalogDetailsPage() {
  return (
    <main className="catalog">
      <p className="eyebrow">qiankun slave</p>
      <h1>Catalog details</h1>
      <p className="description">
        This local Page is available at <code>/details</code> when the slave
        runs standalone and at <code>/catalog/details</code> when mounted by the
        master.
      </p>
      <Link className="button" to="/">
        Back to catalog
      </Link>
    </main>
  );
}
