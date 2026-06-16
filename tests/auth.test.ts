import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import { OrchidAuthContext } from "@orchid-ai/orchid/core";

function mockRequest(auth?: { authorization?: string; xAuthDomain?: string }): FastifyRequest {
    const headers: Record<string, string | string[] | undefined> = {};
    if (auth?.authorization) headers["authorization"] = auth.authorization;
    if (auth?.xAuthDomain) headers["x-auth-domain"] = auth.xAuthDomain;

    return {
        headers,
        authContext: undefined,
    } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply {
    const reply = {
        statusCode: 200,
        raw: {} as FastifyReply["raw"],
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        send(payload: unknown) {
            return payload;
        },
        header() {
            return this;
        },
        getHeader() {
            return undefined;
        },
        getHeaders() {
            return {};
        },
        removeHeader() {},
        callNotFound() {},
        type() {
            return this;
        },
        serialize(payload: unknown) {
            return JSON.stringify(payload);
        },
        then() {
            return {} as Promise<FastifyReply>;
        },
    } as unknown as FastifyReply;
    return reply;
}

describe("resolveAuthContext", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        vi.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.resetModules();
    });

    it("returns 401 when no Bearer token provided", async () => {
        process.env["DEV_AUTH_BYPASS"] = "false";
        const { resolveAuthContext } = await import("../src/auth.js");
        const { appCtx } = await import("../src/context.js");
        appCtx.identityResolver = null;
        appCtx.orchid = null;

        const req = mockRequest({});
        const reply = mockReply();

        await resolveAuthContext(req, reply);
        expect(reply.statusCode).toBe(401);
    });

    it("sets dev auth context when DEV_AUTH_BYPASS is true", async () => {
        process.env["DEV_AUTH_BYPASS"] = "true";
        const { resolveAuthContext } = await import("../src/auth.js");
        const req = mockRequest({ authorization: "anything" });
        const reply = mockReply();

        await resolveAuthContext(req, reply);
        expect(req.authContext).toBeDefined();
        expect(req.authContext?.tenantKey).toBe("99999");
    });

    it("returns 401 when Bearer token malformed", async () => {
        process.env["DEV_AUTH_BYPASS"] = "false";
        const { resolveAuthContext } = await import("../src/auth.js");
        const { appCtx } = await import("../src/context.js");
        appCtx.identityResolver = null;

        const req = mockRequest({ authorization: "Basic something" });
        const reply = mockReply();

        await resolveAuthContext(req, reply);
        expect(reply.statusCode).toBe(401);
    });

    it("returns 503 when no identity resolver configured", async () => {
        process.env["DEV_AUTH_BYPASS"] = "false";
        const { resolveAuthContext } = await import("../src/auth.js");
        const { appCtx } = await import("../src/context.js");
        appCtx.identityResolver = null;

        const req = mockRequest({ authorization: "Bearer test-token" });
        const reply = mockReply();

        await resolveAuthContext(req, reply);
        expect(reply.statusCode).toBe(503);
    });
});

describe("getAuthContext", () => {
    it("throws when auth context not set on request", async () => {
        const { getAuthContext } = await import("../src/auth.js");
        const req = {} as FastifyRequest;
        expect(() => getAuthContext(req)).toThrow();
    });

    it("returns auth context when set", async () => {
        const { getAuthContext } = await import("../src/auth.js");
        const ctx = new OrchidAuthContext({ accessToken: "t", tenantKey: "t1", userId: "u1" });
        const req = { authContext: ctx } as FastifyRequest;
        const result = getAuthContext(req);
        expect(result).toBe(ctx);
    });
});
