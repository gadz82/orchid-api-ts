import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { OrchidSignalQueue, OrchidSignalStore } from "@orchid-ai/orchid/core";

import { resolveAuthContext } from "../auth.js";
import { getAuthContext } from "../auth.js";
import { getEventsRuntime } from "../context.js";
import { parseSince, requireAdmin, isSignalVisible, serialiseSignal } from "./_events.js";

async function signalsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.get("/signals", async (request, reply) => {
        const auth = getAuthContext(request);
        requireAdmin(auth);
        const events = getEventsRuntime<{
            signalStore?: OrchidSignalStore;
        }>();
        if (!events.signalStore) {
            return reply.status(503).send({ detail: "signal store not initialised" });
        }
        const query = request.query as {
            type?: string;
            source?: string;
            since?: string;
            limit?: string;
        };
        const rows = await events.signalStore.list({
            type: query.type,
            tenantKey: auth.tenantKey,
            since: parseSince(query.since) ?? undefined,
            limit: query.limit ? Math.min(Number.parseInt(query.limit, 10) || 100, 1000) : 100,
        });
        const filtered = query.source ? rows.filter((row) => row.source === query.source) : rows;
        return reply.send({ items: filtered.map((signal) => serialiseSignal(signal)) });
    });

    fastify.get("/signals/:signalId", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            signalStore?: OrchidSignalStore;
        }>();
        if (!events.signalStore) {
            return reply.status(503).send({ detail: "signal store not initialised" });
        }
        const params = request.params as { signalId: string };
        const signal = await events.signalStore.get(params.signalId);
        if (!signal || !isSignalVisible(signal, auth)) {
            return reply.status(404).send({ detail: "not found" });
        }
        return reply.send(serialiseSignal(signal));
    });

    fastify.post("/signals/:signalId/replay", async (request, reply) => {
        const auth = getAuthContext(request);
        requireAdmin(auth);
        const events = getEventsRuntime<{
            signalStore?: OrchidSignalStore;
            signalQueue?: OrchidSignalQueue;
        }>();
        if (!events.signalStore) {
            return reply.status(503).send({ detail: "signal store not initialised" });
        }
        if (!events.signalQueue) {
            return reply.status(503).send({ detail: "signal queue not initialised" });
        }
        const params = request.params as { signalId: string };
        const signal = await events.signalStore.get(params.signalId);
        if (!signal || signal.tenantKey !== auth.tenantKey) {
            return reply.status(404).send({ detail: "not found" });
        }
        const queueMsgId = await events.signalQueue.enqueue(signal.signalId);
        return reply.send({
            signal_id: signal.signalId,
            queue_msg_id: queueMsgId,
            replayed_at: new Date().toISOString(),
        });
    });
}

export const router = fp(signalsRouter, { name: "signals" });
