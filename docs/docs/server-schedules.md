# Server schedules

Declare a task beside its business code, in any `.ts`, `.tsx`, `.js`, or `.jsx` module under `src`:

```ts
import { defineSchedule } from "@evjs/ev/schedule";
import { reconcileOrders } from "./orders";

export const syncOrders = defineSchedule(
  { cron: "0 0/5 * * * ?" },
  async () => { await reconcileOrders(); },
);
```

No filename convention, configuration entry, or page import is required. Core discovers named `export const` declarations statically. `defineSchedule` returns the same handler and never starts a timer. Deployment adapters validate the cron dialect and arrange platform scheduling; core does not provide a scheduler.

Options must be an object literal with a non-empty string `cron`, optional string `id`, and optional boolean `disable`. The task ID defaults to the export name. Set `id` to preserve identity when renaming the export. Moving the module does not change identity. Duplicate IDs, computed options, spreads, factories, and default exports produce build diagnostics. Import aliases are supported. The handler takes no arguments; asynchronous work must be included in its returned Promise. Return values are ignored and errors propagate.

Task discovery excludes declaration files, `.test.*`/`.spec.*`, hidden directories, dependencies, build output, `test`, `tests`, `__tests__`, `__mocks__`, `generated`, and `__generated__`. Re-exports do not create extra tasks. A task module cannot use `"use server"` or enter a client import graph. Put shared DTOs and utilities in separate modules; type-only imports are allowed.

```sh
ev inspect
ev schedule run syncOrders
```

`inspect` shows declarations, not current platform trigger state. `schedule run` compiles server code into a temporary output, executes the chosen task once (including disabled tasks), waits for completion, and removes that output. It does not publish deployment artifacts or replace `dist`. Unknown IDs and handler failures return a nonzero exit status. `ev dev` does not run periodic tasks.

The build graph exposes `serverSchedules`; the linked build output and deployment metadata expose `server.schedules`. A task-only application gets a server entry with `runSchedule(taskId)` and no HTTP task endpoint. Adapters own cron validation, platform identities, trigger enablement, retries, concurrency, and timezones. Tasks should be idempotent where repeated execution can occur.
