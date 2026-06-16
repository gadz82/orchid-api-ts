import { JobStatus, type OrchidJobStore, type OrchidSignalQueue } from "@orchid-ai/orchid/core";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext } from "../auth.js";
import { getAuthContext } from "../auth.js";
import { getEventsRuntime } from "../context.js";
import { isRunVisible, parseSince, serialiseRun } from "./_events.js";

async function runsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.get("/runs", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            jobStore: OrchidJobStore;
        }>();
        const query = request.query as {
            status?: string;
            trigger_id?: string;
            since?: string;
            limit?: string;
        };
        const rows = await events.jobStore.list({
            triggerId: query.trigger_id,
            status: query.status,
            since: parseSince(query.since) ?? undefined,
            limit: query.limit ? Math.min(Number.parseInt(query.limit, 10) || 100, 1000) : 100,
        });
        const visible = rows.filter((run) => isRunVisible(run, auth));
        return reply.send({ items: visible.map((run) => serialiseRun(run)) });
    });

    fastify.get("/runs/:runId", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            jobStore: OrchidJobStore;
        }>();
        const params = request.params as { runId: string };
        const run = await events.jobStore.get(params.runId);
        if (!run || !isRunVisible(run, auth)) {
            return reply.status(404).send({ detail: "not found" });
        }
        return reply.send(serialiseRun(run, true));
    });

    fastify.get("/runs/:runId/stream", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            jobStore: OrchidJobStore;
            eventStream?: {
                subscribeRun(runId: string): AsyncIterable<{
                    type: string;
                    runId: string;
                    occurredAt: Date;
                    payload: Record<string, unknown>;
                }>;
            };
        }>();
        const params = request.params as { runId: string };
        const run = await events.jobStore.get(params.runId);
        if (!run || !isRunVisible(run, auth)) {
            return reply.status(404).send({ detail: "not found" });
        }
        if (!events.eventStream?.subscribeRun) {
            return reply.status(503).send({ detail: "event stream not configured" });
        }

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        });

        for await (const event of events.eventStream.subscribeRun(params.runId)) {
            const data = JSON.stringify({
                type: event.type,
                run_id: event.runId,
                occurred_at: event.occurredAt.toISOString(),
                payload: event.payload,
            });
            reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
        }
        reply.raw.end();
    });

    fastify.post("/runs/:runId/cancel", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            jobStore: OrchidJobStore;
        }>();
        const params = request.params as { runId: string };
        const run = await events.jobStore.get(params.runId);
        if (!run || !isRunVisible(run, auth)) {
            return reply.status(404).send({ detail: "not found" });
        }
        if (![JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED].includes(run.status)) {
            run.status = JobStatus.CANCELLED;
            run.finishedAt = new Date();
            run.error = "cancelled by operator";
            await events.jobStore.update(run);
        }
        return reply.send(serialiseRun(run, true));
    });

    fastify.post("/runs/:runId/retry", async (request, reply) => {
        const auth = getAuthContext(request);
        const events = getEventsRuntime<{
            jobStore: OrchidJobStore;
            signalQueue: OrchidSignalQueue;
        }>();
        const params = request.params as { runId: string };
        const run = await events.jobStore.get(params.runId);
        if (!run || !isRunVisible(run, auth)) {
            return reply.status(404).send({ detail: "not found" });
        }
        const queueMsgId = await events.signalQueue.enqueue(run.spec.signalId);
        return reply.send({
            previous_run_id: run.runId,
            queue_msg_id: queueMsgId,
            retried_at: new Date().toISOString(),
        });
    });
}

export const router = fp(runsRouter, { name: "runs" });
