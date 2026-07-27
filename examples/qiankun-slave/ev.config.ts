import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 3001,
  },
  server: {
    dev: {
      port: 3004,
    },
  },
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
