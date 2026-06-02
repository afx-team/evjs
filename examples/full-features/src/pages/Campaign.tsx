interface CampaignProps {
  pageId?: string;
}

export default function Campaign(props: CampaignProps) {
  return (
    <main className="layout">
      <section className="panel">
        <h1>PPR Campaign</h1>
        <p data-testid="campaign-page">Page: {props.pageId}</p>
        <div data-evjs-ppr-region="offer">Offer region placeholder</div>
      </section>
    </main>
  );
}
