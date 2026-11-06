# Transport output v1 integration

App ID `transport`; module `eduvize_transport.output_adapter`; fixed renderer `/eduvize-jizdni-rady/published.html`. This module uses the coordinated registry; it contains no alternative output registry/resolver. Published reads use `/api/public/v1/outputs/{id}/data` and never a browser-selected provider URL or admin profile.

## Test image preparation (not executed by this PR)

Install this repository's `eduvize-transport` package into the administration test image from the reviewed commit. Set `EDUVIZE_OUTPUT_ADAPTER_MODULES` to include `eduvize_transport.output_adapter` alongside existing adapters; do not overwrite other modules. Mount the release's transport `data` directory read-only and set `EDUVIZE_TRANSPORT_DATA_DIR` to that absolute path. Configure a separate test `GOLEMIO_API_KEY`, the core test-only output flag, isolated registry database, test school session/profile/assembly and `app.transport` entitlement. Never copy production credentials. Static publication files must be included under `/eduvize-jizdni-rady/`; shared output-client/runtime/segment-profile/nsp-geometry under `/design-system/`.

## Payload v1

Exact keys: `{source:'pid'|'cz_gtfs', stops:string[1..20], types:('bus'|'tram'|'metro'|'train'|'ferry'|'funicular')[], minutes:1..720, limit:1..100, pageSeconds:3..120}`. Integer fields reject booleans; stops are unique and exact catalog names, never provider IDs or URLs. Draft validation is pure; publish checks configured catalog membership. Shared core validates presentation/geometry and ownership. Trusted source catalogs must be release-controlled. Exact-name plus bilateral platform-coordinate matching within 150 m authorizes crossover. Ambiguous and unavailable stops are reported, never guessed. Empty successful board is distinct from missing data.

The backend live hook reads only the immutable published payload, ignores arbitrary request query, checks no cross-school connection supplied by client, and allows only public departure fields. Registry owns entitlement, publication-state and school/profile checks before each hook. Golemio access remains server-only; credential denial fails without fallback. National times use Europe/Prague calendar days and >24:00 service times. Original source observedAt is retained through cache and national fallback. No Render endpoint exists in the adapter or published renderer.

## Client

`published.html` is separate from legacy index bootstrap and has no localStorage/session/profile lookup. Shared runtime owns identity, theme, publication polling/revocation. App aborts polling when runtime clears/aborts and uses a new scoped client after successful verification. Data polling is 30 s; no query settings can override publication. Header/body semantic sizes come from shared segment metrics. Display output pages automatically; interactive output uses explicit previous/next controls. A changed revision/style keeps the same registry URL.

Test-domain administration adds explicit create/save/publish/revoke operations using the shared client; copy/open use getOutputLink only. Mutation intents/keys survive retry in administrator sessionStorage (not public playback); a profile binding is required. Production administration does not mount this test integration. Legacy preview/actions are not certified as stable v1 output paths.

## Local checks

Use Python 3.12 and the shared backend requirements. Set `PYTHONPATH=<core-checkout>:<transport-checkout>`, `EDUVIZE_OUTPUT_CORE=<core-checkout>`, then run `python -m unittest discover -s tests -p test_output_adapter.py -v`. Tests use a real shared OutputRegistry and HTTP router, isolated SQLite and controlled providers. Browser: install Playwright, set `EDUVIZE_OUTPUT_STYLES=<styles-checkout>`, run `node tests/e2e/published-output.cjs` and `node tests/e2e/publication-actions.cjs`. Optional `PLAYWRIGHT_MODULE`, `CHROME_BIN` support a local runtime. `TRANSPORT_PREVIEW` writes a web screenshot.

## Acceptance boundary

Local tests currently use the coordinated WORKING trees `/private/tmp/eduvize-output-admin` and `/private/tmp/eduvize-output-styly`. They include uncommitted shared schema/runtime changes (including kioskLayout and renderer cancellation hooks). Their owning strategy chat has been notified to supply final immutable integration SHAs. Do not claim clean-commit compatibility or a production-ready release until these dependencies are frozen and CI reruns against them. No shared source files were changed by this transport PR.

Still requiring isolated live test activation: build/package/routing of transport adapter and data, actual Golemio test key, two school/profile fixtures, shared auth/licence integration, restart persistence and cold-start network evidence with Render blocked on CLIENT AND SERVER. Browser fixtures alone do not prove the server network or actual provider response. Production deployment remains forbidden.
