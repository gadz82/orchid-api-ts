import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { OrchidJobStore, JobRun } from "@orchid-ai/orchid/core";

import { resolveAuthContext } from "../auth.js";
import { getAuthContext } from "../auth.js";
import { getEventsRuntime, getJobStoreOrThrow } from "../context.js";
import { isRunVisible, serialiseRun } from "./_events.js";

async function jobsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.get("/jobs", async (_request, reply) => {
        const events = getEventsRuntime<{
            triggerRegistry?: {
                all(): Iterable<{
                    triggerId: string;
                    parallelism?: string;
                    visibility?: string;
                    respectChatBinding?: boolean;
                }>;
            };
        }>();
        const triggers = events.triggerRegistry?.all
            ? Array.from(events.triggerRegistry.all())
            : [];
        return reply.send({
            items: triggers.map((trigger) => ({
                trigger_id: trigger.triggerId,
                parallelism: trigger.parallelism ?? "per_user",
                visibility: trigger.visibility ?? "admin",
                respect_chat_binding: trigger.respectChatBinding ?? false,
            })),
        });
    });

    fastify.get("/jobs/:triggerId/runs", async (request, reply) => {
        const auth = getAuthContext(request);
        const jobStore = getJobStoreOrThrow() as OrchidJobStore;
        const events = getEventsRuntime<{
            triggerRegistry?: { get(triggerId: string): unknown };
        }>();
        const params = request.params as { triggerId: string };
        const query = request.query as { status?: string; limit?: string };
        const trigger = events.triggerRegistry?.get?.(params.triggerId);
        if (!trigger) {
            return reply.status(404).send({ detail: "trigger not found" });
        }
        const rows = await jobStore.list({
            triggerId: params.triggerId,
            status: query.status,
            limit: query.limit ? Math.min(Number.parseInt(query.limit, 10) || 50, 500) : 50,
        });
        const visible = rows.filter((run: JobRun) => isRunVisible(run, auth));
        if (!visible.length && rows.length > 0 && !auth.roles.has("admin")) {
            return reply.status(404).send({ detail: "trigger not found" });
        }
        return reply.send({ items: visible.map((run) => serialiseRun(run)) });
    });
}

export const router = fp(jobsRouter, { name: "jobs" });
