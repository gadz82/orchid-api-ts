import {
    OrchidAuthContext,
    OrchidIdentityError,
    OrchidIdentityResolver,
} from "@orchid-ai/orchid/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

class TestIdentityResolver extends OrchidIdentityResolver {
    override async resolve(domain: string, bearerToken: string) {
        if (bearerToken === "bad-token") {
            throw new OrchidIdentityError("invalid token", 401);
        }

        return new OrchidAuthContext({
            accessToken: bearerToken,
            tenantKey: domain || "default-tenant",
            userId: "user-123",
            extra: { email: "user@example.com", role: "admin" },
        });
    }
}

describe("auth-identity router", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(async () => {
        process.env = originalEnv;
        const { appCtx } = await import("../../src/context.js");
        const { resetSettings } = await import("../../src/settings.js");
        appCtx.identityResolver = null;
        resetSettings();
    });

    it("returns 503 when no identity resolver is configured", async () => {
        const { router } = await import("../../src/routers/authIdentity.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/auth/resolve-identity",
            payload: { access_token: "token-123" },
        });

        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ detail: "Identity resolver not configured" });

        await app.close();
    });

    it("resolves identity using the configured resolver", async () => {
        process.env["AUTH_DOMAIN"] = "default.example.com";
        const { appCtx } = await import("../../src/context.js");
        const { resetSettings } = await import("../../src/settings.js");
        resetSettings();
        appCtx.identityResolver = new TestIdentityResolver();

        const { router } = await import("../../src/routers/authIdentity.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/auth/resolve-identity",
            payload: { access_token: "token-123" },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            subject: "user-123",
            bearer: "token-123",
            auth_domain: "default.example.com",
            email: "user@example.com",
            extra: { role: "admin" },
        });

        await app.close();
    });

    it("maps resolver token rejection to 401", async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.identityResolver = new TestIdentityResolver();

        const { router } = await import("../../src/routers/authIdentity.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/auth/resolve-identity",
            payload: { access_token: "bad-token", auth_domain: "tenant.example.com" },
        });

        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ detail: "invalid token" });

        await app.close();
    });
});
