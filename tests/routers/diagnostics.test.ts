import { describe, it, expect } from "vitest";
import Fastify from "fastify";

describe("diagnostics router", () => {
    it("GET /health returns ok", async () => {
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

    it("GET /health returns version", async () => {
        const { router } = await import("../../src/routers/diagnostics.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/health" });
        const body = JSON.parse(res.body);
        expect(body.version).toBeDefined();

        await app.close();
    });
});
