# BUILD REPORT — ekidata

Rebuild of `com.gachi-tokusuru/japan-data-api` (remote-only, keyless capture)
as `@reneturcios/ekidata` 0.1.0 / `io.github.CloudCorpRecords/ekidata`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all 10 tool
names and every required field. Required fields as served, taken from
the fixture (`harness/fixtures/gachi-japan-data-tools-original.json`); a tool
listed with none has **no** `required` key in its served inputSchema:

- `ping` — required: none (no `required` key)
- `get_municipality_context` — required: `name_or_code`
- `get_station_context` — required: [] (empty array, verbatim; key present)
- `get_toilet_by_station` — required: `station`
- `get_public_toilet_by_city` — required: `city`
- `get_station_hazard` — required: `station_name`
- `station_search` — required: `q`
- `get_active_alerts` — required: none (no `required` key)
- `get_station_alerts` — required: `station_name`
- `get_train_status` — required: `query`

The fixture's tool literals (name, description, inputSchema —
including every property, description, enum, and default as captured)
are served verbatim from `src/forward.ts`; the capture carries **no**
`title` key on any tool, and none is served. This was verified by the
registration-integrity test (served tools/list deep-equals the fixture's
10 tools in order, including key-presence of `get_station_context`'s
empty `required` array and the absence of `required` on `ping` and
`get_active_alerts`) and again by the parity harness. The capture's
`annotations` and `outputSchema` blocks are not reproduced, per the spec
(parity compares inputSchema).

## What was built

All 19 factory files under `builds/ekidata/`:

- `package.json` (`@reneturcios/ekidata` 0.1.0, bin
  `ekidata` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 89-char string
  "Japanese station, accessibility, hazard and alert data from official sources, in English.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/ekidata:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/ekidata"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-27)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/ekidata`, smoke assertion on server name
  `ekidata`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://api.gachi-tokusuru.com/mcp` (pinned),
  overridable via `GACHI_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `ekidata`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `GACHI_API_KEY` is set, `Authorization: Bearer <key>` is sent
  on every upstream request (header name pinned by the registry
  record; forwarding it from this env var is a labelled
  reconstruction — the capture was keyless). When unset, no auth
  header is sent. No `X-API-Key` header is ever sent. All branches
  are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `ekidata error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed anywhere. The captured surface is
  entirely read-only Japanese public data.

## Lockfile (Route 3, clean from birth)

Generated in a temp dir (`/tmp/ekidata-lock`) containing only the new
`package.json`: `npm install --package-lock-only --ignore-scripts
--offline`. Verified: parses, `name == @reneturcios/ekidata`,
**128 package entries**; copied into the build dir with matching
sha256 (`ee8de0ceb5a8a2bc5ec2211bfd09d82ee7701a46bb401779ba1cf6c4240ef7b3`
on both sides). Then `npm install --offline --ignore-scripts` in the
build dir for `node_modules`.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2325 B, forward.js 21149 B,
  mcp.js 2672 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **45 tests, 45 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 10 tool
  objects, names in order, required fields per tool, key-presence for
  the empty `required: []` on `get_station_context` and for the absent
  `required` on `ping`/`get_active_alerts`, no `title` on any tool;
  session establishment/reuse/session-id handling; env URL override;
  Authorization Bearer header present on every request when the key
  is set / absent when unset / no X-API-Key in either case; verbatim
  argument forwarding for all 10 tools; verbatim result pass-through
  incl. upstream isError and SSE; JSON-RPC/init/malformed/HTTP/throw/
  timeout failures → `ekidata error:`; parseRpcBody; MCP-layer
  validation; CLI --version / unknown exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/gachi-japan-data-tools-original.json --rebuild
  "stdio:node builds/ekidata/dist/cli.js mcp" --out
  builds/ekidata/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 10/10 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 89 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for ekidata; only the
mechanics were patterned on the sibling simscout build, and only the
fixture's tool literals are served verbatim.
