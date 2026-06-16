import { OrchidAuthExchangeClient } from "@orchid-ai/orchid/core";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

class TestExchangeClient extends OrchidAuthExchangeClient {
    override async exchangeCode(code: string, redirectUri: string, codeVerifier?: string) {
        return {
            accessToken: `${code}:${redirectUri}:${codeVerifier ?? "none"}`,
            refreshToken: "refresh-123",
            expiresIn: 3600,
        };
    }

    override async refreshToken(refreshToken: string) {
        return {
            accessToken: `fresh:${refreshToken}`,
            expiresIn: 1800,
        };
    }
}

describe("auth-exchange router", () => {
    afterEach(async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.authExchangeClient = null;
    });

    it("returns 503 when no exchange client is configured", async () => {
        const { router } = await import("../../src/routers/authExchange.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/auth/exchange-code",
            payload: { code: "abc", redirect_uri: "http://localhost/callback" },
        });

        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ detail: "Auth exchange client not configured" });

        await app.close();
    });

    it("exchanges and refreshes tokens without auth preconditions", async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.authExchangeClient = new TestExchangeClient();

        const { router } = await import("../../src/routers/authExchange.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const exchangeRes = await app.inject({
            method: "POST",
            url: "/auth/exchange-code",
            payload: {
                code: "abc",
                redirect_uri: "http://localhost/callback",
                code_verifier: "verifier",
            },
        });
        expect(exchangeRes.statusCode).toBe(200);
        expect(exchangeRes.json()).toEqual({
            access_token: "abc:http://localhost/callback:verifier",
            token_type: "Bearer",
            refresh_token: "refresh-123",
            expires_in: 3600,
        });

        const refreshRes = await app.inject({
            method: "POST",
            url: "/auth/refresh-token",
            payload: { refresh_token: "refresh-123" },
        });
        expect(refreshRes.statusCode).toBe(200);
        expect(refreshRes.json()).toEqual({
            access_token: "fresh:refresh-123",
            token_type: "Bearer",
            expires_in: 1800,
        });

        await app.close();
    });
});
