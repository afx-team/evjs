import { campaignMetrics, campaignSegments } from "../domain/operations";
import RenderModePage from "./RenderModePage";

interface CampaignProps {
  pageId?: string;
}

export default function Campaign(props: CampaignProps) {
  return (
    <RenderModePage
      backHref="/"
      description="The static shell is served first, with declared dynamic regions rendered separately."
      mode="ppr"
      title="PPR"
    >
      <section className="panel hero-panel hero-panel--ppr">
        <div>
          <p className="eyebrow">PPR page shell</p>
          <h1>Spring Launch Campaign</h1>
          <p>
            The hero, compliance copy, and campaign schedule are stable enough
            to pre-render. Inventory allocation stays dynamic and is filled by
            the declared PPR region.
          </p>
        </div>
        <dl className="meta-list">
          <div>
            <dt>Page</dt>
            <dd data-testid="campaign-page">{props.pageId}</dd>
          </div>
          <div>
            <dt>Shell</dt>
            <dd>cacheable HTML</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>offer inventory</dd>
          </div>
        </dl>
      </section>

      <section className="status-grid" aria-label="Campaign metrics">
        {campaignMetrics.map((metric) => (
          <div className="status" key={metric.id}>
            <h2>{metric.label}</h2>
            <strong>{metric.value}</strong>
            <span>{metric.trend}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Static campaign shell</h2>
          <span>ready before dynamic inventory resolves</span>
        </div>
        <div className="campaign-segments">
          {campaignSegments.map((segment) => (
            <article className="segment-card" key={segment.id}>
              <span>{segment.state === "static" ? "shell" : "region"}</span>
              <h3>{segment.name}</h3>
              <p>{segment.audience}</p>
              <strong>{segment.offer}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="panel ppr-region-panel">
        <div>
          <p className="eyebrow">Dynamic PPR region</p>
          <h2>Live offer inventory</h2>
          <p>
            This placeholder is intentionally present in the shell. The
            framework server can render the region separately at
            <code> /__evjs/ppr/campaign/offer</code> with its own cache policy.
          </p>
        </div>
        <div
          className="region-placeholder"
          data-evjs-ppr-region="offer"
          data-testid="offer-placeholder"
        >
          <span />
          <strong>Offer region placeholder</strong>
          <em>waiting for live allocation</em>
        </div>
      </section>
    </RenderModePage>
  );
}
