import { campaignMetrics, inventoryReservations } from "@/domain/operations";

export const cache = { revalidate: 30 } as const;

export default function OfferRegion() {
  const conversion = campaignMetrics.find(
    (metric) => metric.id === "conversion",
  );

  return (
    <section className="region-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Dynamic allocation</p>
          <h2>Offer Region</h2>
        </div>
        <span>revalidated every 30s</span>
      </div>
      <p data-testid="offer-region">
        Dynamic PPR region rendered on demand for priority merchant segments.
      </p>
      <div className="inventory-grid">
        {inventoryReservations.map((reservation) => (
          <article className="inventory-card" key={reservation.id}>
            <strong>{reservation.sku}</strong>
            <span>{reservation.region}</span>
            <meter
              max={reservation.reserved + reservation.available}
              min="0"
              value={reservation.reserved}
            >
              {reservation.reserved}
            </meter>
            <em>
              {reservation.available.toLocaleString()} units left after{" "}
              {reservation.reserved.toLocaleString()} reserved
            </em>
          </article>
        ))}
      </div>
      <p data-testid="offer-conversion">
        Conversion: {conversion?.value} ({conversion?.trend})
      </p>
    </section>
  );
}
