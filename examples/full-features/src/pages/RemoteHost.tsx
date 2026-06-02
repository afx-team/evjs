import { createShell } from "@evjs/client";
import type { BuildOutput } from "@evjs/ev";
import * as React from "react";
import { useEffect, useRef, useState } from "react";

const hostManifest: BuildOutput = {
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
      manifest: "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    },
  },
};

export default function RemoteHost() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const shell = createShell({
      manifest: hostManifest,
      shared: {
        react: {
          version: "19.2.5",
          singleton: true,
          value: React,
        },
      },
      resolveMountPoint: () => mountRef.current,
      onError(error) {
        setStatus(error instanceof Error ? error.message : "remote error");
      },
    });

    let disposed = false;
    void shell.activate({ url: "/crm/customers", hydrate: false }).then(() => {
      if (!disposed) setStatus("mounted");
    });

    return () => {
      disposed = true;
      void shell.dispose();
    };
  }, []);

  return (
    <main className="layout">
      <section className="panel">
        <h1>Remote Host</h1>
        <p data-testid="remote-status">Remote: {status}</p>
        <div ref={mountRef} data-testid="remote-mount" />
      </section>
    </main>
  );
}
