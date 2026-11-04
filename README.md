# ekidata

ekidata is a small local bridge to a hosted MCP server
that relays official Japanese public data in English:
municipality and station context, accessible-toilet
lookups, station hazard categories from MLIT data,
station search, live JMA river and landslide alerts, and
Tokyo-area train status.

The bridge keeps no dataset of its own. It serves the
upstream server's tool list locally, exactly as captured
from the live endpoint, and forwards each tool call
upstream, returning the result untouched. Every tool in
the captured surface only reads public data.

## Tools

- `ping` — connection test and freshness check. No
  arguments and no required fields.
- `get_municipality_context` — official data for a
  municipality by 5-digit code or exact name. Required:
  `name_or_code`. Optional: `fields`.
- `get_station_context` — the same municipality context
  resolved from a station name or station_id. Its
  captured schema carries an empty required list, so
  either identifier may be supplied.
- `get_toilet_by_station` — accessible toilets inside a
  station, with floor, equipment and nearest exit.
  Required: `station`.
- `get_public_toilet_by_city` — public toilets in a
  municipality, with accessibility flags, address and
  coordinates. Required: `city`.
- `get_station_hazard` — official disaster-risk
  categories at a station, relayed from MLIT data.
  Required: `station_name`.
- `station_search` — find stations by describing what
  should be around them, in English or Japanese, with
  optional filters such as `name_contains`, `pref`,
  `limit`, ramen, toilet, diaper and flood-rank options.
  Required: `q`.
- `get_active_alerts` — live JMA river flood forecasts
  and landslide alerts. Optional: `area`. No required
  fields.
- `get_station_alerts` — those same JMA alerts for a
  station's prefecture. Required: `station_name`.
- `get_train_status` — live Tokyo-area train service
  status by line or station name. Required: `query`.

## Configuration

- `GACHI_MCP_URL` (optional) — override the upstream
  endpoint. Defaults to `https://api.gachi-tokusuru.com/mcp`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `GACHI_API_KEY` (optional) — when set, every upstream
  request carries an `Authorization: Bearer <key>` header.
  When it is not set, no auth header is sent. (This
  forwarding is also a labelled reconstruction; the
  original surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC `initialize`
request (protocolVersion `2025-03-26`, clientInfo name
`ekidata`), then a `notifications/initialized`
notification, then the `tools/call` request carrying
the caller's arguments unchanged. When the upstream
answers `initialize` with an `Mcp-Session-Id` header,
that value rides on every later request of the session,
which is reused for the life of the process. Replies
may arrive as plain JSON or as server-sent events;
both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `ekidata error:` (this rendering is
this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON argument
string (omit it for tools that take none):

```bash
npx @reneturcios/ekidata ping
npx @reneturcios/ekidata get_municipality_context '{"name_or_code":"13104"}'
npx @reneturcios/ekidata station_search '{"q":"terminal station with late-night ramen"}'
npx @reneturcios/ekidata get_train_status '{"query":"Yamanote"}'
npx @reneturcios/ekidata --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/ekidata mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "ekidata": {
      "command": "npx",
      "args": ["-y", "@reneturcios/ekidata", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/ekidata
docker run --rm ghcr.io/cloudcorprecords/ekidata --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
