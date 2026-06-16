import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
    OrchidAuthConfigProvider,
    OrchidMCPClientRegistration,
    OrchidMCPTokenRecord,
} from "@orchid-ai/orchid/core";

describe("mcp-auth router", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env["DEV_AUTH_BYPASS"] = "true";
        process.env["API_BASE_URL"] = "http://localhost:8000";
    });

    afterEach(async () => {
        process.env = originalEnv;
        vi.restoreAllMocks();
        const { appCtx } = await import("../../src/context.js");
        appCtx.orchid = null;
        appCtx.oauthStateStore = null;
    });

    it("lists OAuth servers and performs authorize/callback/revoke flow", async () => {
        const registrations = new Map<string, OrchidMCPClientRegistration>();
        const tokens = new Map<string, OrchidMCPTokenRecord>();
        const stateStore = new Map<string, Record<string, unknown>>();

        const { appCtx } = await import("../../src/context.js");
        appCtx.oauthStateStore = {
            getState: async (state: string) => stateStore.get(state) ?? null,
            setState: async (state: string, data: Record<string, unknown>) => {
                stateStore.set(state, data);
            },
            deleteState: async (state: string) => {
                stateStore.delete(state);
            },
        };
        appCtx.orchid = {
            runtime: {
                mcpAuthRegistry: {
                    oauthServers: new Map([["remote-mcp", { agentNames: ["assistant"] }]]),
                    getServer(name: string) {
                        if (name === "remote-mcp") {
                            return { url: "https://remote.example.com/mcp" };
                        }
                        return null;
                    },
                    requiresOAuth(name: string) {
                        return name === "remote-mcp";
                    },
                },
                mcpClientRegistrationStore: {
                    get: async (serverName: string) => registrations.get(serverName) ?? null,
                    save: async (record: OrchidMCPClientRegistration) => {
                        registrations.set(record.serverName, record);
                    },
                },
                mcpTokenStore: {
                    getToken: async (tenantId: string, userId: string, serverName: string) =>
                        tokens.get(`${tenantId}:${userId}:${serverName}`) ?? null,
                    saveToken: async (record: OrchidMCPTokenRecord) => {
                        tokens.set(
                            `${record.tenantId}:${record.userId}:${record.serverName}`,
                            record,
                        );
                    },
                    deleteToken: async (tenantId: string, userId: string, serverName: string) =>
                        tokens.delete(`${tenantId}:${userId}:${serverName}`),
                    listTokens: async () => [...tokens.values()],
                },
            },
            close: async () => {},
        } as any;

        vi.spyOn(globalThis, "fetch").mockImplementation(
            async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url === "https://remote.example.com/.well-known/oauth-authorization-server") {
                    return new Response(
                        JSON.stringify({
                            authorization_endpoint: "https://issuer.example.com/authorize",
                            token_endpoint: "https://issuer.example.com/token",
                            registration_endpoint: "https://issuer.example.com/register",
                            issuer: "https://issuer.example.com",
                            scopes_supported: ["openid", "profile"],
                            token_endpoint_auth_methods_supported: ["client_secret_post"],
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                }

                if (url === "https://issuer.example.com/register") {
                    return new Response(
                        JSON.stringify({
                            client_id: "client-1",
                            client_secret: "secret-1",
                            client_id_issued_at: 10,
                            client_secret_expires_at: 0,
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                }

                if (url === "https://issuer.example.com/token") {
                    expect(init?.method).toBe("POST");
                    return new Response(
                        JSON.stringify({
                            access_token: "access-1",
                            refresh_token: "refresh-1",
                            expires_in: 3600,
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                }

                throw new Error(`unexpected fetch ${url}`);
            },
        );

        const { router } = await import("../../src/routers/mcpAuth.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const listRes = await app.inject({
            method: "GET",
            url: "/mcp/auth/servers",
            headers: { authorization: "Bearer any" },
        });
        expect(listRes.statusCode).toBe(200);
        expect(listRes.json()).toEqual([
            {
                server_name: "remote-mcp",
                agent_names: ["assistant"],
                authorized: false,
                token_expired: false,
                discovered: false,
                scopes: "",
            },
        ]);

        const discoverRes = await app.inject({
            method: "POST",
            url: "/mcp/auth/servers/remote-mcp/discover",
            headers: { authorization: "Bearer any" },
            payload: {},
        });
        expect(discoverRes.statusCode).toBe(200);
        expect(discoverRes.json().authorization_endpoint).toBe(
            "https://issuer.example.com/authorize",
        );

        const authorizeRes = await app.inject({
            method: "GET",
            url: "/mcp/auth/servers/remote-mcp/authorize",
            headers: { authorization: "Bearer any" },
        });
        expect(authorizeRes.statusCode).toBe(200);
        const authorizeBody = authorizeRes.json();
        expect(authorizeBody.authorize_url).toContain("https://issuer.example.com/authorize");
        expect(authorizeBody.state).toBeTruthy();

        const callbackRes = await app.inject({
            method: "GET",
            url: `/mcp/auth/callback?code=oauth-code&state=${encodeURIComponent(authorizeBody.state)}`,
        });
        expect(callbackRes.statusCode).toBe(200);
        expect(callbackRes.body).toContain("Authorization successful");

        const storedToken = tokens.get("99999:dev-user-00000000:remote-mcp");
        expect(storedToken?.accessToken).toBe("access-1");

        const revokeRes = await app.inject({
            method: "DELETE",
            url: "/mcp/auth/servers/remote-mcp/token",
            headers: { authorization: "Bearer any" },
        });
        expect(revokeRes.statusCode).toBe(204);

        await app.close();
    });
});
