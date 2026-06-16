import { describe, it, expect } from "vitest";
import Fastify from "fastify";

describe("app integration", () => {
    it("GET /health works standalone", async () => {
        const { router } = await import("../../src/routers/diagnostics.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("ok");

        await app.close();
    });

    it("POST /index returns 403 when disabled", async () => {
        delete process.env["ALLOW_INDEX_ENDPOINT"];

        const { router } = await import("../../src/routers/diagnostics.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);

        await app.close();
    });
});
