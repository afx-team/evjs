import { useRemoteHost } from "@evjs/ev/client";
import RenderModePage from "./RenderModePage";

const productionRemoteManifest =
  "https://assets.example.com/crm/evjs-remote.json";

export default function RemoteApp() {
  const remote = useRemoteHost({
    remote: "crm",
    manifest: productionRemoteManifest,
    activeWhen: "/crm/*",
    request: "/crm/customers",
  });
  const status =
    remote.status === "error"
      ? remote.error instanceof Error
        ? remote.error.message
        : "remote error"
      : remote.status;

  return (
    <RenderModePage
      backHref="/"
      description="The host page is CSR, then the shell runtime activates a remote module."
      mode="csr"
      title="CSR + Remote"
    >
      <section className="panel">
        <p className="eyebrow">Manifest-driven remote shell</p>
        <h1>CRM Workspace Host</h1>
        <p>
          The host app delegates the customer success workspace to a remote
          bundle while negotiating the React shared dependency.
        </p>
        <p data-testid="remote-status">Remote: {status}</p>
        <p data-testid="remote-shared">
          Shared: {remote.sharedSummary ?? "pending"}
        </p>
        <div
          className="remote-frame"
          ref={remote.mountRef}
          data-testid="remote-mount"
        />
      </section>
    </RenderModePage>
  );
}
