# orchid-api-ts — AI Context

## What This Package Is

`@orchid-ai/orchid-api` is the Fastify HTTP adapter for Orchid. It is a thin server layer over `@orchid-ai/orchid`:
request parsing, auth resolution, lifecycle wiring, response shaping, and transport-specific concerns live here. Agent
logic, graph orchestration, and backend implementations do not.

## Architectural Rules

1. Keep this package thin. If logic is framework-level, it belongs in `@orchid-ai/orchid`.
2. Identity resolution happens once
   in [src/auth.ts](/Users/francesco.marchesini/orchid-workspace/workspace-ts/orchid-api-ts/src/auth.ts).
3. `AppContext` owns one `Orchid` instance plus API-only dependencies and stores.
4. Routers stay domain-scoped. Do not add ad hoc endpoints
   to [src/main.ts](/Users/francesco.marchesini/orchid-workspace/workspace-ts/orchid-api-ts/src/main.ts).
5. Request and response wire shapes stay snake_case for Python parity.
6. Runtime store wiring happens
   in [src/lifecycle.ts](/Users/francesco.marchesini/orchid-workspace/workspace-ts/orchid-api-ts/src/lifecycle.ts), not
   in routers.
7. Hot reload, export serving, plugin router discovery, and tracing setup are app-layer concerns and stay in this
   package.

## Current Package Shape

```text
src/
  app.ts
  auth.ts
  cli.ts
  context.ts
  devIdentity.ts
  lifecycle.ts
  main.ts
  middleware.ts
  models.ts
  rateLimit.ts
  settings.ts
  tracing.ts
  events/
    bootstrap.ts
    producers/http.ts
  helpers/
    state.ts
    streamBuffer.ts
    visibility.ts
  routers/
    _events.ts
    admin.ts
    authExchange.ts
    authIdentity.ts
    authInfo.ts
    chatEvents.ts
    chats.ts
    diagnostics.ts
    jobs.ts
    mcpAuth.ts
    mcpGateway.ts
    mcpGatewayState.ts
    messages.ts
    resume.ts
    runs.ts
    schedules.ts
    session.ts
    sharing.ts
    signals.ts
    streaming.ts
```

## Runtime Responsibilities

`setupOrchid()` currently does all package-local runtime initialization:

- build `Orchid` from config
- apply tracing env vars
- initialize built-in SQLite chat storage
- initialize SQLite outbound MCP token storage
- initialize SQLite MCP client-registration storage
- initialize SQLite inbound MCP gateway-state storage
- initialize OAuth pending-state storage
- start API event adapters
- warm unauthenticated MCP capabilities

If a router depends on one of those resources, it should fetch it through helpers
in [src/context.ts](/Users/francesco.marchesini/orchid-workspace/workspace-ts/orchid-api-ts/src/context.ts).

## Endpoint Notes

### Public bridge endpoints

These intentionally do not require upstream Bearer auth:

- `GET /auth-info`
- `POST /auth/exchange-code`
- `POST /auth/refresh-token`
- `POST /auth/resolve-identity`
- `GET /mcp/auth/callback`

Do not “secure” them by forcing normal user auth; their protection comes from OAuth grant semantics or PKCE state.

### Service-token endpoints

`/mcp-gateway/state/*` is protected by `MCP_GATEWAY_STATE_SERVICE_TOKEN`. Empty token means the entire group should
return `503`, not silently degrade.

### Event endpoints

The event routers expose the Pollen+Bloom HTTP surface. Their API behavior lives here, but the deeper event-processing
substrate still depends on the framework side being wired. Keep the router contract stable even if the underlying
runtime evolves.

## Testing Expectations

When changing this package:

- add or update router tests under `tests/routers/`
- keep app/helper tests under `tests/main.test.ts`, `tests/httpProducer.test.ts`, `tests/helpers/*`
- run:

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

## Pitfalls

- `POST /chats/:chatId/messages` must keep multipart-compatible parsing.
- Do not persist augmented prompts instead of the original user message.
- Avoid depending on undeclared runtime packages in Fastify logger config.
- Keep the callback/auth pages HTML-escaped; they process user-controlled OAuth values.
- The storage class defaults in `settings.ts` are TypeScript-native (`sqlite`), not Python dotted paths.
