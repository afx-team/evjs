import type { AppContext, SharedScope } from "@evjs/client";
import "./remote.css";

let initializedSharedReactVersion = "not-initialized";

export function init(sharedScope: SharedScope, ctx: AppContext): void {
  initializedSharedReactVersion =
    sharedScope.react?.version ??
    ctx.remote?.shared.provided.react?.version ??
    "missing";
}

export interface CrmRemoteWorkspaceProps {
  ctx?: AppContext;
  remote?: AppContext["remote"];
  request?: AppContext["request"];
}

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

export default function CrmRemoteWorkspace({
  ctx,
  remote,
  request,
}: CrmRemoteWorkspaceProps) {
  const sharedReactVersion =
    remote?.shared.provided["remote-react"]?.version ??
    remote?.shared.provided.react?.version ??
    "missing";
  const sourceLabel = getRemoteSourceLabel(ctx);
  const entryId = remote?.entryId ?? "unknown";
  const requestUrl = request?.url?.toString() ?? "unknown";

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
        <div className="crm-remote__source">{sourceLabel}</div>
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
          <dd data-testid="remote-entry">{entryId}</dd>
        </div>
        <div>
          <dt>Request</dt>
          <dd data-testid="remote-url">{requestUrl}</dd>
        </div>
        <div>
          <dt>Shared remote-react</dt>
          <dd data-testid="remote-shared">{sharedReactVersion}</dd>
        </div>
        <div>
          <dt>Init shared react</dt>
          <dd data-testid="remote-init">{initializedSharedReactVersion}</dd>
        </div>
      </dl>
    </section>
  );
}

function getRemoteSourceLabel(ctx: AppContext | undefined): string {
  const baseUrl = ctx?.remote?.manifest.baseUrl;
  if (!baseUrl) return "served from remote manifest";

  try {
    const url = new URL(baseUrl);
    return `served from ${url.host}`;
  } catch {
    return `served from ${baseUrl}`;
  }
}
