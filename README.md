# @orchid-ai/orchid-api

Fastify HTTP server for the [Orchid](https://github.com/gadz82/orchid) multi-agent AI framework — TypeScript port of `orchid-api`.

Provides HTTP endpoints for chat management, streamed message handling, document uploads, RAG sharing, MCP gateway state, and identity bridging. This is a thin HTTP layer — all agent logic, graph building, and persistence live in `@orchid-ai/orchid`.

## What Lives Here

- Fastify app factory and CLI entrypoint
- Env-driven settings with `orchid.yml` overlay
- API lifecycle wiring for `Orchid`, tracing, SQLite-backed stores, and event adapters
- Domain routers for chats, messages, streaming, sharing, auth, MCP auth, gateway state, admin, diagnostics, and event endpoints

What does **not** live here:

- Agent implementations
- Graph logic
- RAG backend logic
- Persistence backend implementations beyond wiring built-in stores

Those belong in `@orchid-ai/orchid` or consumer projects.

## Dependency Matrix

`@orchid-ai/orchid-api` depends on `@orchid-ai/orchid` (framework library), which ships with `null` and `in_memory` backends only. Additional backends are separate plugin packages — install them based on your `orchid.yml` configuration:

| If your config sets this… | Install this alongside `@orchid-ai/orchid-api` |
|---|---|
| `rag.vector_backend: qdrant` | `npm install @orchid-ai/rag-qdrant` |
| `rag.vector_backend: chroma` | `npm install @orchid-ai/rag-chroma` |
| `rag.vector_backend: neo4j` | `npm install @orchid-ai/rag-neo4j` |
| `storage.class: @orchid-ai/storage-postgres/*` | `npm install @orchid-ai/storage-postgres` |
| `checkpointer.type: postgres` | `npm install @orchid-ai/storage-postgres` |

A missing plugin raises a clear error at startup with an `npm install` hint.

## Quick Start

```bash
npm install @orchid-ai/orchid @orchid-ai/orchid-api
ORCHID_CONFIG=./orchid.yml orchid-api
```

For a fully wired demo:

```bash
docker compose -f docker-compose.demo.yml up --build
# API:    http://localhost:8000
# Qdrant: http://localhost:6333
```

Programmatic usage:

```ts
import { buildApp } from "@orchid-ai/orchid-api/app";
import { getSettings } from "@orchid-ai/orchid-api/settings";

const app = await buildApp({ settings: getSettings() });
await app.listen({ port: 8000, host: "0.0.0.0" });
```

## Runtime Wiring

At startup, `setupOrchid()`:

1. Builds the `Orchid` facade from config
2. Applies LangSmith tracing env vars when enabled
3. Initializes chat storage
4. Initializes outbound MCP token storage
5. Initializes MCP client-registration storage
6. Initializes inbound MCP gateway-state storage
7. Initializes OAuth pending-state storage
8. Warms unauthenticated MCP capabilities
9. Boots the API-side event adapters (when `events.enabled: true`)

Built-in storage defaults are SQLite at `~/.orchid/chats.db`.

## Endpoints

### Chats and messages

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/chats` | Create a chat session |
| `GET` | `/chats` | List user's chat sessions |
| `DELETE` | `/chats/{chatId}` | Delete a chat session |
| `GET` | `/chats/{chatId}/messages` | Load chat message history |
| `POST` | `/chats/{chatId}/messages` | Send a message (multipart/form-data) |
| `POST` | `/chats/{chatId}/messages/stream` | SSE-streamed message send |
| `POST` | `/chats/{chatId}/upload` | Upload documents for chat RAG |
| `POST` | `/chats/{chatId}/resume` | Resume after a HITL approval pause |
| `POST` | `/chats/{chatId}/share` | Promote chat RAG data to user scope |
| `POST` | `/session/warm` | Warm MCP capability caches per (tenant_key, user_id) |
| `GET` | `/health` | Readiness check |

### Auth bridge

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/auth-info` | Public posture + upstream-OAuth discovery |
| `POST` | `/auth/exchange-code` | Server-side authorization-code exchange |
| `POST` | `/auth/refresh-token` | Server-side refresh-token exchange |
| `POST` | `/auth/resolve-identity` | Identity bridge — upstream token → `OrchidAuthContext` |

These four endpoints are intentionally unauthenticated — protected by PKCE, single-use codes, or the upstream token itself.

### Outbound MCP OAuth (per-user external-server tokens)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/mcp/auth/servers` | List OAuth MCP servers + user auth status |
| `POST` | `/mcp/auth/servers/{name}/discover` | Discover OAuth metadata for a server |
| `GET` | `/mcp/auth/servers/{name}/authorize` | Generate OAuth authorization URL (PKCE) |
| `GET` | `/mcp/auth/callback` | OAuth IdP redirect callback |
| `DELETE` | `/mcp/auth/servers/{name}/token` | Revoke stored OAuth token |

### Inbound MCP gateway state (multi-replica gateway support)

Gated by `MCP_GATEWAY_STATE_SERVICE_TOKEN` — returns 503 when unset.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp-gateway/state/clients` | Register a DCR client (RFC 7591) |
| `GET` | `/mcp-gateway/state/clients/{clientId}` | Fetch a registered client |
| `POST` | `/mcp-gateway/state/auth-codes` | Insert a pending auth-code record |
| `POST` | `/mcp-gateway/state/auth-codes/lookup-by-upstream-state` | Correlate via upstream `state` echo |
| `PATCH` | `/mcp-gateway/state/auth-codes/{code}` | Patch (post-callback identity / IdP tokens) |
| `POST` | `/mcp-gateway/state/auth-codes/{code}/consume` | Atomic one-shot consume |
| `POST` | `/mcp-gateway/state/tokens` | Issue a gateway access + refresh pair |
| `POST` | `/mcp-gateway/state/tokens/introspect` | Look up by access_token xor refresh_token |
| `DELETE` | `/mcp-gateway/state/tokens/{accessToken}` | Revoke |

### Gateway exposure config

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/mcp-gateway/config` | Tool title/description overrides + MCP Prompts (consumed by orchid-mcp) |

### Events and operations (Pollen + Bloom)

Active only when `events.enabled: true` in `agents.yaml`; otherwise routers return 503.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/signals` | Admin-only. List recent signals |
| `GET` | `/signals/{signalId}` | Fetch a single signal (visibility-filtered) |
| `POST` | `/signals/{signalId}/replay` | Admin-only. Re-enqueue an existing signal |
| `GET` | `/jobs` | List declared triggers (read-only) |
| `GET` | `/jobs/{triggerId}/runs` | List runs for a trigger |
| `GET` | `/runs` | List recent JobRun rows |
| `GET` | `/runs/{runId}` | Fetch a single run |
| `GET` | `/runs/{runId}/stream` | SSE — bloom.* events for this run |
| `POST` | `/runs/{runId}/cancel` | Best-effort cancel |
| `POST` | `/runs/{runId}/retry` | Force a fresh attempt |
| `GET` | `/schedules` | Admin-only. List declared schedules |
| `GET` | `/schedules/{scheduleId}` | Admin-only. Fetch one schedule |
| `PATCH` | `/schedules/{scheduleId}` | Admin-only. Toggle enabled / change cron |
| `GET` | `/chats/{chatId}/events/stream` | SSE — chat.bloom.* events for chat-bound Blooms |

Per-id endpoints honour a strict **404-never-403** contract.

## Streaming event vocabulary

`POST /chats/{id}/messages/stream` returns Server-Sent Events:

| Event | Payload | When emitted |
|---|---|---|
| `assistant.delta` | `{ "text": "..." }` | Per token of the assistant's reply |
| `supervisor.routing_decision` | `{ "agents": [...], "execution": "parallel\|sequential\|skill" }` | After supervisor LLM picks routes |
| `agent.started` | `{ "name": "..." }` | When a sub-agent begins executing |
| `agent.finished` | `{ "name": "...", "summary": "..." }` | When a sub-agent emits its final message |
| `mini_agent.decomposed` | `{ "parent": "...", "count": N, "sub_tasks": [...] }` | When a parent agent's decomposer fires |
| `mini_agent.started` | `{ "parent": "...", "mini_id": "...", "description": "..." }` | When each fork starts |
| `mini_agent.finished` | `{ "parent": "...", "mini_id": "...", "status": "ok\|failed\|timeout", "duration_ms": ... }` | When each fork ends |
| `mini_agent.aggregated` | `{ "parent": "...", "n_outcomes": ... }` | When the aggregator collapses outcomes |
| `tool_call.requires_approval` | `{ "tool": "...", "args": {...}, "interrupt_id": "..." }` | When a HITL tool needs user approval |
| `assistant.complete` | `{ "message": "..." }` | Final completion marker |

## Configuration

Settings are environment variables, optionally populated from `orchid.yml` via `ORCHID_CONFIG`:

### Core

| Setting | Default | Purpose |
|---------|---------|---------|
| `ORCHID_CONFIG` | — | Path to `orchid.yml` |
| `AGENTS_CONFIG_PATH` | `agents.yaml` | Path to agent YAML config |
| `API_BASE_URL` | `http://localhost:8000` | Public API URL for OAuth callbacks |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://frontend:3000` | Allowed CORS origins |
| `DEV_AUTH_BYPASS` | `false` | Skip auth (dev only) |
| `LANGSMITH_TRACING` | `false` | Enable LangSmith tracing |

### Identity & Auth

| Setting | Default | Purpose |
|---------|---------|---------|
| `IDENTITY_RESOLVER_CLASS` | — | Dotted path to `OrchidIdentityResolver` subclass |
| `AUTH_CONFIG_PROVIDER_CLASS` | — | Dotted path to `OrchidAuthConfigProvider` |
| `AUTH_EXCHANGE_CLIENT_CLASS` | — | Dotted path to `OrchidAuthExchangeClient` |

### MCP Gateway

| Setting | Default | Purpose |
|---------|---------|---------|
| `MCP_GATEWAY_STATE_SERVICE_TOKEN` | — | Shared secret gating `/mcp-gateway/state/*` — empty disables the endpoint group |

## Development

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

## Notes

- `GET /auth-info`, `POST /auth/exchange-code`, `POST /auth/refresh-token`, and `POST /auth/resolve-identity` are intentionally public bridge endpoints.
- `GET /mcp/auth/callback` is intentionally unauthenticated; PKCE state binds the flow.
- `/mcp-gateway/state/*` returns 503 when `MCP_GATEWAY_STATE_SERVICE_TOKEN` is unset.
- `POST /chats/{chatId}/messages` accepts multipart upload-compatible requests.

## License

MIT
