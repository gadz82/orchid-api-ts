import { describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("HTTPIngestionProducer", () => {
    it("accepts POST /signals when a dispatcher is started", async () => {
        const { HTTPIngestionProducer } = await import("../src/events/producers/http.js");
        const producer = new HTTPIngestionProducer(null);
        await producer.start({
            ingest: async (payload: Record<string, unknown>) => ({
                signal_id: "sig-123",
                accepted: payload["type"],
            }),
        });

        const app = Fastify();
        await app.register(producer.router);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/signals",
            payload: { type: "ticket.created" },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            signal_id: "sig-123",
            accepted: "ticket.created",
        });

        await app.close();
    });
});
