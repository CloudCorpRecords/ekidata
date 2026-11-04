# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the hosted Gachi Japan data MCP server, serving all 10 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `ping`, `get_municipality_context`, `get_station_context`, `get_toilet_by_station`, `get_public_toilet_by_city`, `get_station_hazard`, `station_search`, `get_active_alerts`, `get_station_alerts`, `get_train_status`.
- Upstream results pass through verbatim; upstream failures surface as `ekidata error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `GACHI_MCP_URL`; when `GACHI_API_KEY` is set it is sent as an `Authorization: Bearer` header on every upstream request.
