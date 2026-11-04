/**
 * ekidata core: a forwarding client for the hosted
 * Gachi Japan data MCP server.
 *
 * Nothing is computed locally. tools/list is answered
 * from the literal tool definitions below, taken verbatim
 * from a live capture of the upstream server (name,
 * description and inputSchema exactly as captured; the
 * capture carries no title key on any tool, and its
 * annotations and outputSchema blocks are not reproduced).
 * A tools/call is forwarded over a streamable-HTTP
 * JSON-RPC session: an initialize POST, a
 * notifications/initialized POST, then the tools/call
 * POST, honouring the Mcp-Session-Id response header when
 * the upstream issues one. The session is established
 * lazily on the first forwarded call and reused for the
 * lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://api.gachi-tokusuru.com/mcp and can be overridden
 * with the GACHI_MCP_URL environment variable (that
 * override is a labelled reconstruction). When
 * GACHI_API_KEY is set in the environment, every upstream
 * request carries an `Authorization: Bearer <key>` header
 * (the header name is pinned by the registry record;
 * forwarding it from this env var is a labelled
 * reconstruction — the capture itself was taken
 * keyless). When the variable is unset, no auth header is
 * sent.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `ekidata error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://api.gachi-tokusuru.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/gachi-japan-data-tools-original.json)  */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "ping",
    "description": "Connection test / health check — call this first to confirm the server is reachable. Returns server identity, deploy version, tool count, station coverage, and the update times of the realtime layers (JMA alerts, train status) so you can confirm freshness, not just liveness. No auth, no arguments, lightweight.",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "get_municipality_context",
    "description": "Official Japanese government data for any municipality, one call — housing vacancy (2003–2023), nearest-station ridership trend, hazard categories, land prices, livability counts. No scores, no judgment — official values only. Accepts a 5-digit municipality code (13104) or an exact name (Shinjuku-ku / 新宿区).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name_or_code": {
          "type": "string",
          "description": "5-digit 全国地方公共団体コード (e.g. 13104) or exact municipality name (Shinjuku-ku / 新宿区)."
        },
        "fields": {
          "type": "string",
          "description": "Optional comma-separated subset: vacancy,ridership,population,hazard,land_price,livability."
        }
      },
      "required": [
        "name_or_code"
      ]
    }
  },
  {
    "name": "get_station_context",
    "description": "Same official municipality data as get_municipality_context, resolved from a station: pass a station name (Shinjuku / 新宿 / Musashi-Kosugi) or a Japan Station Master station_id (e.g. st_00001), and it returns the context for that station's municipality. Official values only — no scores.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "station_name": {
          "type": "string",
          "description": "Station name in English/romaji (Shinjuku) or Japanese (新宿). Provide this or station_id."
        },
        "station_id": {
          "type": "string",
          "description": "Japan Station Master station_id (e.g. st_00001). Alternative to station_name."
        },
        "fields": {
          "type": "string",
          "description": "Optional comma-separated subset: vacancy,ridership,population,hazard,land_price,livability."
        }
      },
      "required": []
    }
  },
  {
    "name": "get_toilet_by_station",
    "description": "Look up wheelchair-accessible / multipurpose toilets inside a train station, including floor, gender, equipment (wheelchair, ostomate, diaper table) and the nearest exit. Covers 526 Tokyo stations (Tokyo Bureau of Social Welfare data). Major stations outside Tokyo (Yokohama, Kawasaki, Omiya, Chiba, Fujisawa, Shin-Yokohama…) return an in-station layer that groups accessible toilets by ticket gate — inside vs outside — per railway operator. Accepts Japanese (新宿, 横浜) or romaji (Shinjuku, Yokohama) for major stations.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "station": {
          "type": "string",
          "description": "Station name in Japanese (新宿, 渋谷) or romaji for major stations (Shinjuku, Shibuya, Kita-Senju)."
        }
      },
      "required": [
        "station"
      ]
    }
  },
  {
    "name": "get_public_toilet_by_city",
    "description": "List public toilets in a Japanese municipality, with wheelchair / baby-seat / ostomate flags, address and coordinates. Covers 612 municipalities nationwide (large cities capped at the top 50 results). Municipality names accept Japanese (e.g. 那覇市, 渋谷区); prefixing the prefecture improves accuracy.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "Municipality name in Japanese (e.g. 那覇市, 渋谷区, 上天草市). Prefix the prefecture for accuracy."
        }
      },
      "required": [
        "city"
      ]
    }
  },
  {
    "name": "get_station_hazard",
    "description": "Official disaster-risk categories at a Japanese train station, relayed live from the MLIT 不動産情報ライブラリ (Real Estate Information Library): flood inundation-depth rank, landform / liquefaction classification, and storm-surge inundation-area presence (landslide & tsunami are license-restricted and return available:false with a link to the official maps). Returns the official values/categories as-is — no composite score, no judgment. Accepts a station name in Japanese (新宿, 武蔵小杉) or romaji (Shinjuku, Musashi-Kosugi). For research/analytics; NOT a substitute for official government hazard maps or evacuation decisions.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "station_name": {
          "type": "string",
          "description": "Station name in Japanese (新宿, 武蔵小杉) or romaji (Shinjuku, Musashi-Kosugi)."
        }
      },
      "required": [
        "station_name"
      ]
    }
  },
  {
    "name": "station_search",
    "description": "Discover Japanese train stations by describing what you want around them, in English or Japanese — \"朝ラーメンが食べられて車椅子トイレがある駅\", \"terminal station with late-night ramen\", \"水害リスクが低くてラーメンが多い駅\". Semantic search over 9,035 station profiles (lines/terminal size, ramen density & styles, in-station accessible-toilet equipment, official hazard categories, ridership) with hybrid metadata filters — the filters guarantee the constraint, the embedding ranks by fit. Filter intent in the query text (朝ラー/深夜/おむつ/車椅子/水害リスク低…) is auto-applied (filter_source: inferred); explicit params win. Water-hazard intent (水害/洪水/浸水/高潮…リスク低) expands to flood rank AND storm-surge zone; 液状化/地盤 intent filters on the official liquefaction-tendency category; results carry risk_notes when other official hazard categories are high. Inferred facility filters with partial data coverage (おむつ/車椅子 — Tokyo-only data) BOOST confirmed stations instead of excluding unknowns (see soft_filters); explicit params remain strict. Taste/quality words (うまい, \"good food\", delicious…) are not evaluated (no review data); ramen ranking reflects shop density and style variety only. name_contains gives exact substring matching on station names (日本語/romaji) when the name itself is the requirement. Coverage notes: toilet stats = Tokyo stations only; ridership = Greater Tokyo operators only; hazard = official MLIT categories relayed as-is, NOT a safety judgment. Role split: station_search finds candidate stations — then get_toilet_by_station / search_ramen / get_station_hazard / get_station_context for detail on one station.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Natural-language description of the station/area you want (ja/en). Concrete attribute words (朝ラー, wheelchair toilet, terminal, 水害リスク低) match best."
        },
        "name_contains": {
          "type": "string",
          "description": "Substring filter on the station name (matches both 日本語 name_ja and romaji name, e.g. \"谷\" or \"sakura\"). ANDs with other filters; q still ranks the matches. Use for \"stations whose name contains X\" requests that semantic search cannot guarantee."
        },
        "pref": {
          "type": "string",
          "description": "Optional prefecture filter, Japanese (東京都, 千葉 OK) or romaji (tokyo/osaka). Auto-inferred from the query text when omitted."
        },
        "limit": {
          "type": "number",
          "description": "Max results (default 10; max 20, or 300 when name_contains is given — set limit >= name_matches_total for exhaustive name-match coverage)."
        },
        "morning_ramen": {
          "type": "boolean",
          "description": "Require morning-ramen availability nearby (auto-inferred from 朝ラー/morning…)."
        },
        "late_ramen": {
          "type": "boolean",
          "description": "Require late-night ramen nearby (auto-inferred from 深夜/late night…)."
        },
        "ramen_min": {
          "type": "number",
          "description": "Require at least this many ramen shops nearby (e.g. 30)."
        },
        "accessible_toilet_min": {
          "type": "number",
          "description": "Require at least this many in-station accessible toilets (Tokyo stations only; auto-inferred from 車椅子/wheelchair…)."
        },
        "diaper": {
          "type": "boolean",
          "description": "Require a diaper changing table in station toilets (auto-inferred from おむつ/子連れ…)."
        },
        "flood_rank_max": {
          "type": "number",
          "description": "Max official flood inundation-depth rank 0–6 (0 = no assumed inundation; auto-inferred from 水害リスク低/flood-safe…)."
        }
      },
      "required": [
        "q"
      ]
    }
  },
  {
    "name": "get_active_alerts",
    "description": "Live river flood forecasts and landslide alerts for Japan (JMA official). NOT general weather warnings (storm/heavy rain/snow) and NOT earthquakes. Covers JMA 指定河川洪水予報 (river flood forecast, levels 2–5) and 土砂災害警戒情報 (landslide warning), each with level, affected area, official summary and issue time. Optional `area` filters by 2-digit prefecture code (e.g. 13 = Tokyo) or a JMA forecast-area code. Relay of official facts — not a warning issued by this service, not a life-safety system.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "area": {
          "type": "string",
          "description": "Optional prefecture code (01–47, e.g. 13 = Tokyo) or JMA forecast-area code."
        }
      }
    }
  },
  {
    "name": "get_station_alerts",
    "description": "Live JMA river flood forecasts and landslide alerts affecting a station's prefecture — NOT general weather warnings. Ask by station name in Japanese (新宿) or romaji (Shinjuku). Prefecture-level match (station master is Greater Tokyo). Relay of official JMA facts.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "station_name": {
          "type": "string",
          "description": "Station name in Japanese (新宿) or romaji (Shinjuku)."
        }
      },
      "required": [
        "station_name"
      ]
    }
  },
  {
    "name": "get_train_status",
    "description": "Live train service status for Tokyo-area lines — delays, suspensions, resumptions. Ask 'is the Yamanote Line running?' by line or station name, English or Japanese. Status enum: normal / delayed / suspended / resumed. Cause text relayed from ODPT (English summary for known patterns, else original text + null). Data via ODPT (CC BY 4.0).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Line or station name (English or Japanese), e.g. \"Yamanote\" or \"新宿\"."
        }
      },
      "required": [
        "query"
      ]
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `ekidata error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class EkidataClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).GACHI_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).GACHI_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["Authorization"] = `Bearer ${key}`;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "ekidata", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): EkidataClient {
  return new EkidataClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new EkidataClient(deps).callTool(name, args);
}
