import { JobStatus, type OrchidJobStore } from "@orchid-ai/orchid/core";
import type { OrchidChatStorage } from "@orchid-ai/orchid/persistence";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext } from "../auth.js";
import { getAuthContext } from "../auth.js";
import { getChatStorage, getEventsRuntime, isEventsEnabled } from "../context.js";
import { applyCorsHeaders } from "../helpers/responseHeaders.js";
import { requireChatOwnerOrAdmin, serialiseRun } from "./_events.js";

async function chatEventsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);
    fastify.get("/chats/:chatId/events/stream", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage() as OrchidChatStorage;
        const params = request.params as { chatId: string };
        await requireChatOwnerOrAdmin(params.chatId, auth, chatRepo);

        if (!isEventsEnabled()) {
            // Match orchid-api (Python): get_events_runtime raises 503
            // with {"detail": "events subsystem is disabled ..."} when
            // events.enabled=false in agents.yaml. The frontend's
            // EventSource auto-reconnects on 503 — same as Python.
            applyCorsHeaders(reply);
            reply.raw.writeHead(503, {"Content-Type": "application/json; charset=utf-8"});
            reply.raw.end(
                JSON.stringify({
                    detail: "events subsystem is disabled (events.enabled=false in agents.yaml)",
                }),
            );
            return;
        }

        applyCorsHeaders(reply);
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        });

        const events = getEventsRuntime<{
            jobStore?: OrchidJobStore;
            eventStream?: {
                subscribe(channel: string): AsyncIterable<{
                    type: string;
                    chatId: string;
                    runId: string;
                    occurredAt: Date;
                    payload: Record<string, unknown>;
                }>;
            };
        }>();
        
        // Check for in-flight jobs if jobStore is available
        if (events.jobStore) {
            const inFlight = await events.jobStore.list({
                chatBindingChatId: params.chatId,
                statuses: [JobStatus.PENDING, JobStatus.RUNNING],
                limit: 200,
            });
            for (const run of inFlight) {
                const data = JSON.stringify({
                    type: "chat.bloom.attached",
                    chat_id: params.chatId,
                    run_id: run.runId,
                    occurred_at: (run.startedAt ?? run.queuedAt).toISOString(),
                    payload: serialiseRun(run),
                });
                reply.raw.write(`event: chat.bloom.attached\ndata: ${data}\n\n`);
            }
        }

        if (events.eventStream?.subscribe) {
            for await (const event of events.eventStream.subscribe(`chat:${params.chatId}`)) {
                const data = JSON.stringify({
                    type: event.type,
                    chat_id: event.chatId,
                    run_id: event.runId,
                    occurred_at: event.occurredAt.toISOString(),
                    payload: event.payload,
                });
                reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
            }
        } else {
            reply.raw.write(": idle\n\n");
        }
        reply.raw.end();
    });
}

export const router = fp(chatEventsRouter, { name: "chatEvents" });
