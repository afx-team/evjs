import { useRemoteContext } from "@evjs/client";
import "./remote.css";

const customerHealthSignals = [
  {
    label: "Health score",
    value: "92",
    detail: "expansion-ready",
  },
  {
    label: "Open revenue",
    value: "$184.2k",
    detail: "renewal influence",
  },
  {
    label: "Success owner",
    value: "Grace Hopper",
    detail: "enterprise pod",
  },
];

const playbookSteps = [
  {
    title: "Schedule retention offer review",
    detail: "Align fee waiver timing with the merchant's weekend GMV window.",
  },
  {
    title: "Confirm settlement account",
    detail: "Request finance sign-off before the next payout release batch.",
  },
  {
    title: "Attach churn evidence",
    detail:
      "Bundle chargeback trend, low inventory recovery, and support notes.",
  },
];

export default function CrmRemoteWorkspace() {
  const remote = useRemoteContext();
  const requestUrl = remote.requestUrl ?? "unknown";

  return (
    <section className="crm-remote" data-testid="crm-remote-card">
      <div className="crm-remote__hero">
        <div>
          <span className="crm-remote__badge">Remote CRM workspace</span>
          <h2>Northstar Outdoor</h2>
          <p>
            This remote is a normal React component. The host shell owns
            loading, mounting, unmounting, stylesheet injection, and shared
            dependency negotiation.
          </p>
        </div>
        <div className="crm-remote__source" data-testid="remote-source">
          {remote.source}
        </div>
      </div>

      <div className="crm-remote__metrics">
        {customerHealthSignals.map((signal) => (
          <article className="crm-remote__metric" key={signal.label}>
            <span>{signal.label}</span>
            <strong
              data-testid={`remote-${signal.label.toLowerCase().replaceAll(" ", "-")}`}
            >
              {signal.value}
            </strong>
            <em>{signal.detail}</em>
          </article>
        ))}
      </div>

      <section className="crm-remote__playbook">
        <div>
          <p className="crm-remote__eyebrow">Customer success playbook</p>
          <h3>Next best actions</h3>
        </div>
        <ol>
          {playbookSteps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      <dl className="crm-remote__runtime">
        <div>
          <dt>Entry</dt>
          <dd data-testid="remote-entry">{remote.entryId}</dd>
        </div>
        <div>
          <dt>Request</dt>
          <dd data-testid="remote-url">{requestUrl}</dd>
        </div>
      </dl>
    </section>
  );
}
