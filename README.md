# `@orchid-ai/orchid-api`

Fastify HTTP server for the Orchid TypeScript runtime. This package is the TypeScript port of Python `orchid-api`: a
thin HTTP adapter over `@orchid-ai/orchid`, with chat/message endpoints, auth helpers, outbound MCP OAuth, inbound MCP
gateway state, and the Pollen+Bloom event HTTP surface.

## What Lives Here

- Fastify app factory and CLI entrypoint
- Env-driven settings with `orchid.yml` overlay
- API lifecycle wiring for `Orchid`, tracing, SQLite-backed stores, and event adapters
- Domain routers for chats, messages, streaming, sharing, auth, MCP auth, gateway state, admin, diagnostics, and event
  endpoints

What does **not** live here:

- Agent implementations
- Graph logic
- RAG backend logic
- Persistence backend implementations beyond wiring built-in stores

Those belong in `@orchid-ai/orchid` or consumer projects.

## Install

```bash
npm install @orchid-ai/orchid @orchid-ai/orchid-api
```

## Run

```bash
ORCHID_CONFIG=./orchid.yml orchid-api
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

- builds the `Orchid` facade from config
- applies LangSmith tracing env vars when enabled
- initializes chat storage
- initializes outbound MCP token storage
- initializes MCP client-registration storage
- initializes inbound MCP gateway-state storage
- initializes OAuth pending-state storage
- warms unauthenticated MCP capabilities
- boots the API-side event adapters

Built-in storage defaults are SQLite:

- `CHAT_STORAGE_CLASS=sqlite`
- `MCP_TOKEN_STORE_CLASS=sqlite`
- `MCP_CLIENT_REGISTRATION_STORE_CLASS=sqlite`
- `MCP_GATEWAY_STATE_STORE_CLASS=sqlite`

The default DSN is `~/.orchid/chats.db`.

## Endpoint Surface

### Chats and messages

- `POST /chats`
- `GET /chats`
- `GET /chats/:chatId/messages`
- `DELETE /chats/:chatId`
- `POST /chats/:chatId/messages`
- `POST /chats/:chatId/messages/stream`
- `POST /chats/:chatId/upload`
- `POST /chats/:chatId/resume`
- `POST /chats/:chatId/share`
- `POST /session/warm`

### Auth bridge

- `GET /auth-info`
- `POST /auth/exchange-code`
- `POST /auth/refresh-token`
- `POST /auth/resolve-identity`

### Outbound MCP OAuth

- `GET /mcp/auth/servers`
- `POST /mcp/auth/servers/:name/discover`
- `GET /mcp/auth/servers/:name/authorize`
- `GET /mcp/auth/callback`
- `DELETE /mcp/auth/servers/:name/token`

### Inbound MCP gateway state

- `POST /mcp-gateway/state/clients`
- `GET /mcp-gateway/state/clients/:clientId`
- `POST /mcp-gateway/state/auth-codes`
- `POST /mcp-gateway/state/auth-codes/lookup-by-upstream-state`
- `PATCH /mcp-gateway/state/auth-codes/:code`
- `POST /mcp-gateway/state/auth-codes/:code/consume`
- `POST /mcp-gateway/state/tokens`
- `POST /mcp-gateway/state/tokens/introspect`
- `DELETE /mcp-gateway/state/tokens/:accessToken`

### Events and operations

- `GET /signals`
- `GET /signals/:signalId`
- `POST /signals/:signalId/replay`
- `GET /jobs`
- `GET /jobs/:triggerId/runs`
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/stream`
- `POST /runs/:runId/cancel`
- `POST /runs/:runId/retry`
- `GET /schedules`
- `GET /schedules/:scheduleId`
- `PATCH /schedules/:scheduleId`
- `GET /chats/:chatId/events/stream`
- `POST /index`
- `GET /health`

## Configuration

Important settings:

- `ORCHID_CONFIG`
- `API_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `DEV_AUTH_BYPASS`
- `IDENTITY_RESOLVER_CLASS`
- `AUTH_CONFIG_PROVIDER_CLASS`
- `AUTH_EXCHANGE_CLIENT_CLASS`
- `MCP_GATEWAY_STATE_SERVICE_TOKEN`
- `LANGSMITH_TRACING`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT`
- `ORCHID_RELOAD_INTERVAL`

`settings.ts` is the source of truth for defaults.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

## Notes

- `GET /auth-info`, `POST /auth/exchange-code`, `POST /auth/refresh-token`, and `POST /auth/resolve-identity` are
  intentionally public bridge endpoints.
- `GET /mcp/auth/callback` is intentionally unauthenticated; PKCE state binds the flow.
- `/mcp-gateway/state/*` is disabled unless `MCP_GATEWAY_STATE_SERVICE_TOKEN` is set.
- `POST /chats/:chatId/messages` accepts multipart upload-compatible requests; do not assume JSON-only clients.

## License

MIT
