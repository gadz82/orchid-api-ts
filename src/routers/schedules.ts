import type { OrchidScheduleRecord, OrchidScheduleStore } from "@orchid-ai/orchid/core";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext } from "../auth.js";
import { getAuthContext } from "../auth.js";
import { getEventsRuntime } from "../context.js";
import { requireAdmin } from "./_events.js";

async function schedulesRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.get("/schedules", async (request, reply) => {
        requireAdmin(getAuthContext(request));
        const events = getEventsRuntime<{
            scheduleStore: OrchidScheduleStore;
        }>();
        const rows = Array.from(await events.scheduleStore.list());
        return reply.send({ items: rows.map((row) => serialiseSchedule(row)) });
    });

    fastify.get("/schedules/:scheduleId", async (request, reply) => {
        requireAdmin(getAuthContext(request));
        const events = getEventsRuntime<{
            scheduleStore: OrchidScheduleStore;
        }>();
        const params = request.params as { scheduleId: string };
        const record = await events.scheduleStore.get(params.scheduleId);
        if (!record) {
            return reply.status(404).send({ detail: "not found" });
        }
        return reply.send(serialiseSchedule(record));
    });

    fastify.patch("/schedules/:scheduleId", async (request, reply) => {
        requireAdmin(getAuthContext(request));
        const events = getEventsRuntime<{
            scheduleStore: OrchidScheduleStore;
            producers?: Array<{ refresh?(): Promise<void> }>;
        }>();
        const params = request.params as { scheduleId: string };
        const body = (request.body ?? {}) as {
            enabled?: boolean;
            cron?: string | null;
            interval_seconds?: number | null;
        };
        const record = await events.scheduleStore.get(params.scheduleId);
        if (!record) {
            return reply.status(404).send({ detail: "not found" });
        }
        const patched: OrchidScheduleRecord = {
            ...record,
            enabled: body.enabled ?? record.enabled,
            cron: body.cron !== undefined ? body.cron : record.cron,
            intervalSeconds:
                body.interval_seconds !== undefined
                    ? body.interval_seconds
                    : record.intervalSeconds,
        };
        if (body.cron !== undefined && body.interval_seconds === undefined) {
            patched.intervalSeconds = null;
        }
        if (body.interval_seconds !== undefined && body.cron === undefined) {
            patched.cron = null;
        }

        await events.scheduleStore.upsert(patched);
        for (const producer of events.producers ?? []) {
            if (producer.refresh) {
                try {
                    await producer.refresh();
                } catch {
                    // Keep schedule patching non-fatal even when producer refresh fails.
                }
            }
        }
        return reply.send(serialiseSchedule(patched));
    });
}

export const router = fp(schedulesRouter, { name: "schedules" });

function serialiseSchedule(record: OrchidScheduleRecord): Record<string, unknown> {
    return {
        schedule_id: record.scheduleId,
        trigger_id: record.triggerId,
        cron: record.cron,
        interval_seconds: record.intervalSeconds,
        identity_claim: record.identityClaim,
        last_fire_at: record.lastFireAt?.toISOString() ?? null,
        next_fire_at: record.nextFireAt?.toISOString() ?? null,
        enabled: record.enabled,
    };
}
