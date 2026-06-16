import { OrchidAuthConfigProvider } from "@orchid-ai/orchid/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

class TestAuthConfigProvider extends OrchidAuthConfigProvider {
    override resolveConfig() {
        return {
            domain: "tenant.example.com",
            authorizationEndpoint: "https://issuer.example.com/authorize",
            tokenEndpoint: "https://issuer.example.com/token",
            scopes: "openid profile",
            clientId: "client-123",
            refreshViaApi: true,
        };
    }
}

describe("auth-info router", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(async () => {
        process.env = originalEnv;
        const { appCtx } = await import("../../src/context.js");
        const { resetSettings } = await import("../../src/settings.js");
        appCtx.authConfigProvider = null;
        appCtx.authExchangeClient = null;
        appCtx.identityResolver = null;
        resetSettings();
    });

    it("GET /auth-info is public and reports posture", async () => {
        process.env["DEV_AUTH_BYPASS"] = "true";

        const { appCtx } = await import("../../src/context.js");
        const { resetSettings } = await import("../../src/settings.js");
        resetSettings();
        appCtx.authConfigProvider = new TestAuthConfigProvider();

        const { router } = await import("../../src/routers/authInfo.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/auth-info" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            dev_bypass: true,
            identity_resolver_configured: false,
            oauth: {
                auth_domain: "tenant.example.com",
                authorization_endpoint: "https://issuer.example.com/authorize",
                token_endpoint: "https://issuer.example.com/token",
                client_id: "client-123",
                scope: "openid profile",
                exchange_via_api: false,
                refresh_via_api: false,
                resolve_via_api: false,
            },
        });

        await app.close();
    });
});
