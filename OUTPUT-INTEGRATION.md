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

Integration sources are now frozen by the coordinator: `eduvize-admin@2f1f4786425698bea33935c85e901e5628a36995` and `eduvize-styly@72a19387158ca63dc7a819438a5e94d4f3462936`, recorded in output-dependencies.json. The earlier apparent working-tree differences were local mirror commit differences; the GitHub implementation pins include the required kioskLayout and renderer cancellation hooks. All 10 HTTP integration tests pass against the clean exact backend checkout. The expanded integration workflow now runs for pull requests with these pinned defaults; workflow_dispatch can explicitly select another reviewed SHA. The initial local-working-tree hashes are retained only as historical audit evidence, not as the current dependency contract. No shared source files were changed by this transport PR.

Still requiring isolated live test activation: build/package/routing of transport adapter and data, actual Golemio test key, two school/profile fixtures, shared auth/licence integration, restart persistence and cold-start network evidence with Render blocked on CLIENT AND SERVER. Browser fixtures alone do not prove the server network or actual provider response. Production deployment remains forbidden.

## Private dependency access in CI

Full registry integration runs in the private eduvize-admin repository using its own read-only default Actions token. It checks out the exact core/styles references in output-dependencies.json and the exact transport candidate SHA. It runs the adapter HTTP suite on SQLite and PostgreSQL 18 plus the published browser matrix. No PAT or read credential is added to this public repository; no private backend source is uploaded as an artifact. The public service-boundary workflow checks the internal PID boundary independently.

## Internal PID service boundary

Administration sets EDUVIZE_TRANSPORT_REALTIME_URL=http://transit:8000/api/v1/pid/departures. This is the only accepted internal target; Render, production and arbitrary endpoints are rejected. The transit service runs eduvize_transport.pid:app with no internal override and owns the separate test Golemio credential. The original provider observation time is retained through its cache and the internal hop. Authentication denial remains denial and never becomes planned fallback. National data is immutable release content mounted/read from EDUVIZE_TRANSPORT_DATA_DIR.

Live external PID acceptance still requires a separately supplied test credential. Its absence is recorded explicitly; it is not a passed real-provider test.
