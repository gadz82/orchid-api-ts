import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("mcp-gateway-state router", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env["MCP_GATEWAY_STATE_SERVICE_TOKEN"] = "svc-token";
    });

    afterEach(async () => {
        process.env = originalEnv;
        const { appCtx } = await import("../../src/context.js");
        appCtx.orchid = null;
    });

    it("persists and returns clients, auth codes, and tokens", async () => {
        const clients = new Map<string, Record<string, unknown>>();
        const authCodes = new Map<string, Record<string, unknown>>();
        const tokens = new Map<string, Record<string, unknown>>();

        const { appCtx } = await import("../../src/context.js");
        appCtx.orchid = {
            runtime: {
                mcpGatewayStateStore: {
                    register: async (client: Record<string, unknown>) => {
                        clients.set(String(client.clientId), client);
                        return client;
                    },
                    get: async (clientId: string) => (clients.get(clientId) as any) ?? null,
                    put: async (authCode: Record<string, unknown>) => {
                        authCodes.set(String(authCode.code), authCode);
                    },
                    getByUpstreamState: async (upstreamState: string) =>
                        [...authCodes.values()].find(
                            (row) => row.upstreamState === upstreamState,
                        ) ?? null,
                    update: async (code: string, patch: Record<string, unknown>) => {
                        authCodes.set(code, { ...authCodes.get(code), ...patch });
                    },
                    consume: async (code: string) => {
                        const record = authCodes.get(code) ?? null;
                        if (record) authCodes.delete(code);
                        return record as any;
                    },
                    issue: async (token: Record<string, unknown>) => {
                        tokens.set(String(token.accessToken), token);
                        return token as any;
                    },
                    getByAccessToken: async (accessToken: string) =>
                        (tokens.get(accessToken) as any) ?? null,
                    getByRefreshToken: async (refreshToken: string) =>
                        ([...tokens.values()].find(
                            (row) => row.refreshToken === refreshToken,
                        ) as any) ?? null,
                    revoke: async (accessToken: string) => tokens.delete(accessToken),
                },
            },
            close: async () => {},
        } as any;

        const { router } = await import("../../src/routers/mcpGatewayState.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const authz = { authorization: "Bearer svc-token" };

        const clientPut = await app.inject({
            method: "POST",
            url: "/mcp-gateway/state/clients",
            headers: authz,
            payload: {
                client_id: "client-1",
                redirect_uris: ["http://localhost/callback"],
                grant_types: ["authorization_code"],
                token_endpoint_auth_method: "none",
            },
        });
        expect(clientPut.statusCode).toBe(204);

        const clientGet = await app.inject({
            method: "GET",
            url: "/mcp-gateway/state/clients/client-1",
            headers: authz,
        });
        expect(clientGet.statusCode).toBe(200);
        expect(clientGet.json().client_id).toBe("client-1");

        const authCodePut = await app.inject({
            method: "POST",
            url: "/mcp-gateway/state/auth-codes",
            headers: authz,
            payload: {
                code: "code-1",
                client_id: "client-1",
                redirect_uri: "http://localhost/callback",
                upstream_state: "state-1",
                expires_at: 123,
            },
        });
        expect(authCodePut.statusCode).toBe(204);

        const lookup = await app.inject({
            method: "POST",
            url: "/mcp-gateway/state/auth-codes/lookup-by-upstream-state",
            headers: authz,
            payload: { upstream_state: "state-1" },
        });
        expect(lookup.statusCode).toBe(200);
        expect(lookup.json().code).toBe("code-1");

        const tokenIssue = await app.inject({
            method: "POST",
            url: "/mcp-gateway/state/tokens",
            headers: authz,
            payload: {
                access_token: "access-1",
                refresh_token: "refresh-1",
                client_id: "client-1",
            },
        });
        expect(tokenIssue.statusCode).toBe(200);
        expect(tokenIssue.json().access_token).toBe("access-1");

        const tokenLookup = await app.inject({
            method: "POST",
            url: "/mcp-gateway/state/tokens/introspect",
            headers: authz,
            payload: { refresh_token: "refresh-1" },
        });
        expect(tokenLookup.statusCode).toBe(200);
        expect(tokenLookup.json().client_id).toBe("client-1");

        const tokenDelete = await app.inject({
            method: "DELETE",
            url: "/mcp-gateway/state/tokens/access-1",
            headers: authz,
        });
        expect(tokenDelete.statusCode).toBe(204);

        await app.close();
    });
});
