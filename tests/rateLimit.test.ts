import { describe, it, expect, vi } from "vitest";

import { createRateLimit } from "../src/rateLimit.js";
import type { FastifyReply, FastifyRequest } from "fastify";

function mockRequest(tenant = "default", user = "test-user"): FastifyRequest {
    return {
        authContext: { tenantKey: tenant, userId: user },
    } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply {
    const reply = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        send(payload: unknown) {
            return payload;
        },
        header(key: string, value: string) {
            this.headers[key] = value;
            return this;
        },
    } as unknown as FastifyReply;
    return reply;
}

describe("createRateLimit", () => {
    it("creates a rate limiter that allows calls under the limit", async () => {
        const rateLimit = createRateLimit("test", 10, 60);
        const req = mockRequest();
        const reply = mockReply();

        // First call should pass
        await rateLimit(req, reply);
        expect(reply.statusCode).toBe(200);
    });

    it("blocks after exceeding limit", async () => {
        const rateLimit = createRateLimit("test2", 2, 60);
        const req = mockRequest("t", "u");
        const reply = mockReply();

        // Consume all tokens
        await rateLimit(req, reply);
        await rateLimit(req, reply);

        // Third call should be blocked
        const blockedReply = mockReply();
        await rateLimit(req, blockedReply);
        expect(blockedReply.statusCode).toBe(429);
    });

    it("allows calls when rate limit is disabled (0 calls)", async () => {
        const rateLimit = createRateLimit("test3", 0, 60);
        const req = mockRequest();
        const reply = mockReply();

        await rateLimit(req, reply);
        expect(reply.statusCode).toBe(200);
    });

    it("uses different keys for different tenants", async () => {
        const rateLimit = createRateLimit("test4", 1, 60);
        const reply = mockReply();

        // Consume for tenant A
        await rateLimit(mockRequest("tenant-a", "user"), reply);
        expect(reply.statusCode).toBe(200);

        // Tenant B should still be allowed
        const replyB = mockReply();
        await rateLimit(mockRequest("tenant-b", "user"), replyB);
        expect(replyB.statusCode).toBe(200);
    });
});
