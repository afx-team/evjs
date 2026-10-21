import { expectTypeOf } from "vitest";
import type {
  FrameworkSlot,
  ServerEntryContribution,
} from "../src/plugin/index.js";

export function checkServerEntryTypes(
  slot: FrameworkSlot<"server.entry">,
  contribution: ServerEntryContribution,
) {
  const entryName: string = slot.add({
    id: "entry",
    mode: "create",
    module: "./handler.ts",
  });
  const imported = slot.add({
    id: "before",
    module: "./before.ts",
    target: { kind: "page", pageId: "home" },
    position: "before-main",
  });
  const replaced = slot.add({
    id: "renderer",
    module: "./render.ts",
    target: { kind: "page", pageId: "home" },
    mode: "replace",
  });
  const result: string | undefined = slot.add(contribution);
  // @ts-expect-error Independent entries do not target an existing Page.
  slot.add({
    id: "bad",
    mode: "create",
    module: "./handler.ts",
    target: { kind: "page", pageId: "home" },
  });
  // @ts-expect-error Independent entries have no insertion position.
  slot.add({
    id: "bad",
    mode: "create",
    module: "./handler.ts",
    position: "before-main",
  });
  // @ts-expect-error Omitting the mode does not create an independent entry.
  slot.add({ id: "bad", module: "./handler.ts" });
  // @ts-expect-error Page replacement still requires a target.
  slot.add({ id: "bad", mode: "replace", module: "./handler.ts" });
  expectTypeOf(imported).toEqualTypeOf<void>();
  expectTypeOf(replaced).toEqualTypeOf<void>();
  return { entryName, imported, replaced, result };
}
