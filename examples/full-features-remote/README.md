# ev Full Features Remote Example

This package represents the CRM workspace loaded by the full-features host app.
It emits `dist/evjs-remote.json` and a remote React component that the host
shell activates for `/crm/*`.

The remote simulates a customer-success panel for `Northstar Outdoor` and
declares React as a shared dependency through `remote.shared`.

Local development runs this remote on port `3002`; the full-features host points
to `http://localhost:3002/evjs-remote.json`.

The recommended remote authoring model is:

- export a normal React component as `default`;
- optionally export `init(sharedScope, ctx)` for shared dependency or startup
  preparation;
- avoid touching the host DOM directly;
- reserve explicit `mount()` / `unmount()` exports for non-React or advanced
  lifecycle modules.

The host e2e test routes remote assets to this build output and verifies:

- remote manifest loading;
- shared scope negotiation;
- one-time remote `init(sharedScope, ctx)`;
- automatic React lifecycle wrapping for the default component.
