import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

const slaveBase = "/__qiankun_slave";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
      container: "#slave-container",
    },
  ],
  routes: [
    {
      path: "/catalog",
      microApp: "catalog",
    },
  ],
  sandbox: true,
  prefetch: true,
}));
