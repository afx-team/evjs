import { supportTickets } from "../domain/operations";
import RenderModePage from "./RenderModePage";

export default function Support() {
  const urgentTickets = supportTickets.filter(
    (ticket) => ticket.priority === "urgent",
  );

  return (
    <RenderModePage
      backHref="/"
      description="This framework-managed page mounts entirely in the browser."
      mode="csr"
      title="CSR"
    >
      <section className="panel hero-panel hero-panel--csr">
        <div>
          <p className="eyebrow">Framework-managed CSR page</p>
          <h1>Support Queue</h1>
          <p>
            This page demonstrates the lighter component-page path: evjs owns
            the runtime boot, while the browser mounts the operational queue and
            local triage controls.
          </p>
        </div>
        <div className="status">
          <h2>Urgent SLA</h2>
          <strong>{urgentTickets.length}</strong>
          <span>client-mounted queue item</span>
        </div>
      </section>

      <section className="status-grid" aria-label="Support queue summary">
        <div className="status">
          <h2>Open tickets</h2>
          <strong>{supportTickets.length}</strong>
          <span>available after browser mount</span>
        </div>
        <div className="status">
          <h2>Escalations</h2>
          <strong>{urgentTickets.length}</strong>
          <span>chargeback and settlement workflows</span>
        </div>
        <div className="status">
          <h2>Next sync</h2>
          <strong>15m</strong>
          <span>agent-side refresh cadence</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Open merchant tickets</h2>
          <span>CSR page content mounted by the generic runtime</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Merchant</th>
              <th>Issue</th>
              <th>Priority</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {supportTickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.id}</td>
                <td>{ticket.merchant}</td>
                <td>{ticket.issue}</td>
                <td>{ticket.priority}</td>
                <td>{ticket.sla}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Local triage workspace</h2>
        <div className="triage-grid">
          <article>
            <strong>Evidence bundle</strong>
            <span>
              collect chargeback PDF, shipment proof, and merchant note
            </span>
          </article>
          <article>
            <strong>Account verification</strong>
            <span>request updated bank owner document</span>
          </article>
          <article>
            <strong>Agent note</strong>
            <span>drafted locally before server submission</span>
          </article>
        </div>
      </section>
    </RenderModePage>
  );
}
