import { describe, expect, it } from "vitest";
import { collectPluginHooks } from "../src/_internal/build/plugin-lifecycle.js";
import type { Plugin, PluginContext } from "../src/plugin/index.js";

describe("collectPluginHooks", () => {
  it("retires the setup context before disposing a partial plugin snapshot", async () => {
    const events: string[] = [];
    let retired = false;
    const context = {
      mode: "development",
      command: "dev",
      cwd: "/project",
      config: {} as PluginContext["config"],
      logger: {} as PluginContext["logger"],
      addWatchFile(file: string) {
        if (!retired) events.push(`watch:${file}`);
      },
    } satisfies PluginContext;
    const plugins: Plugin[] = [
      {
        name: "first",
        setup(setupContext) {
          events.push("setup:first");
          return {
            dispose() {
              events.push("dispose:first");
              setupContext.addWatchFile("late-watch.txt");
            },
          };
        },
      },
      {
        name: "second",
        setup() {
          events.push("setup:second");
          throw new Error("setup blocked");
        },
      },
    ];

    await expect(
      collectPluginHooks(plugins, context, () => {
        events.push("beforeRollback");
        retired = true;
      }),
    ).rejects.toThrow("setup blocked");

    expect(events).toEqual([
      "setup:first",
      "setup:second",
      "beforeRollback",
      "dispose:first",
    ]);
  });
});
