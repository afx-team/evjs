# ev Full Features Remote Example

This package represents the CRM workspace loaded by the full-features host app.
It emits `dist/evjs-remote.json` and a remote React component that the host
shell activates for `/crm/*`.

The remote simulates a customer-success panel for `Northstar Outdoor` and
declares React as a shared dependency through `remote.shared`.

Local development can serve this remote on port `3002`. The host component keeps
only the production manifest URL. If an app wants query-string manifest
switching for debugging, it must opt in with `manifestQueryParam`; the default
host behavior always uses the configured manifest URL.

The recommended remote authoring model is:

- export a normal React component as `default`;
- read remote metadata with `useRemoteContext()` only when the component needs
  entry, request, or source diagnostics;
- avoid touching the host DOM directly;
- reserve explicit `init()`, `mount()`, `hydrate()`, and `unmount()` exports for
  non-React or advanced lifecycle modules.

The host e2e test routes remote assets to this build output and verifies:

- remote manifest loading;
- host-side shared scope negotiation diagnostics;
- automatic React lifecycle wrapping for the default component;
- stylesheet loading from the remote manifest.
