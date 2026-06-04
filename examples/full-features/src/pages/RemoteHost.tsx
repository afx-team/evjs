import { createShell } from "@evjs/client";
import type { BuildOutput, RemoteManifest, RemoteOutput } from "@evjs/ev";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import RenderModePage from "./RenderModePage";

const productionRemoteManifest =
  "https://assets.example.com/crm/evjs-remote.json";
const localDevRemoteManifest = "http://localhost:3002/evjs-remote.json";

function createHostManifest(remoteManifest: string): BuildOutput {
  return {
    version: 1,
    buildId: "full-features-remote-host",
    distDir: "dist",
    publicPath: "/",
    runtime: {},
    assets: {},
    apps: {},
    pages: {},
    routes: [],
    remotes: {
      crm: {
        manifest: remoteManifest,
        activeWhen: ["/crm/*"],
      },
    },
  };
}

function readRemoteManifestOverride(): string {
  return (
    new URL(globalThis.location.href).searchParams.get("remoteManifest") ??
    getDefaultRemoteManifest()
  );
}

function getDefaultRemoteManifest(): string {
  const hostname = globalThis.location.hostname;
  if (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    globalThis.location.port === "3000"
  ) {
    return localDevRemoteManifest;
  }
  return productionRemoteManifest;
}

async function loadRemoteManifest(
  remote: RemoteOutput,
): Promise<RemoteManifest> {
  const response = await fetch(remote.manifest);
  if (!response.ok) {
    throw new Error(
      `Remote manifest failed: ${response.status} ${response.statusText}`,
    );
  }

  const manifest = (await response.json()) as RemoteManifest;
  if (isLocalRemoteManifest(remote.manifest)) {
    return {
      ...manifest,
      baseUrl: new URL(".", remote.manifest).toString(),
    };
  }
  return manifest;
}

function isLocalRemoteManifest(manifestUrl: string): boolean {
  try {
    const url = new URL(manifestUrl, globalThis.location.href);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export default function RemoteHost() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const hostManifest = createHostManifest(readRemoteManifestOverride());
    const shell = createShell({
      manifest: hostManifest,
      shared: {
        react: {
          version: "19.2.5",
          singleton: true,
          value: React,
        },
      },
      loadRemoteManifest,
      resolveMountPoint: () => mountRef.current,
      onError(error) {
        setStatus(error instanceof Error ? error.message : "remote error");
      },
    });

    let disposed = false;
    void shell
      .activate({ url: "/crm/customers", hydrate: false })
      .then(() => {
        if (!disposed) setStatus("mounted");
      })
      .catch((error) => {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : "remote error");
        }
      });

    return () => {
      disposed = true;
      void shell.dispose();
    };
  }, []);

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
        <div
          className="remote-frame"
          ref={mountRef}
          data-testid="remote-mount"
        />
      </section>
    </RenderModePage>
  );
}
