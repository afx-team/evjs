# ev Full Features Remote Example

This package represents the CRM workspace loaded by the full-features host app.
It emits `dist/evjs-remote.json` and a lifecycle module that the host shell
activates for `/crm/*`.

The remote simulates a customer-success panel for `Northstar Outdoor` and
declares React as a shared dependency through `remote.shared`. The host e2e test
routes remote assets to this build output and verifies:

- remote manifest loading;
- shared scope negotiation;
- one-time remote `init(sharedScope, ctx)`;
- lifecycle `mount()` rendering into the host-provided mount point.
