import type { EvBundlerCtx } from "@evjs/ev";
import type { Configuration } from "webpack";
import { webpack } from "./packages/bundler-webpack/src/plugin-helper.js";

const bundlerHook = webpack((config) => {});
const realConfig: Record<string, unknown> = { module: { rules: [] } };
const CTX: EvBundlerCtx<unknown> = {
  mode: "production",
  cwd: "",
  config: { bundler: { name: "webpack" } } as EvBundlerCtx<unknown>["config"],
};
bundlerHook(realConfig, CTX);
