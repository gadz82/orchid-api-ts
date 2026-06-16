import {
    OrchidAuthContext,
    OrchidIdentityResolver,
    JobStatus,
    type JobRun,
    type OrchidScheduleRecord,
    type Signal,
} from "@orchid-ai/orchid/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

class TestIdentityResolver extends OrchidIdentityResolver {
    override async resolve(_domain: string, bearerToken: string): Promise<OrchidAuthContext> {
        return new OrchidAuthContext({
            accessToken: bearerToken,
            tenantKey: "tenant-1",
            userId: bearerToken === "admin-token" ? "admin-user" : "user-1",
            roles: bearerToken === "admin-token" ? ["admin"] : [],
        });
    }
}

describe("event routers", () => {
    beforeEach(() => {
        process.env["DEV_AUTH_BYPASS"] = "false";
    });

    afterEach(async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.events = null;
        appCtx.identityResolver = null;
        appCtx.orchid = null;
    });

    it("signals router enforces admin visibility and replays signals", async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.identityResolver = new TestIdentityResolver();

        const signal: Signal = {
            signalId: "sig-1",
            type: "ticket.created",
            source: "helpdesk",
            payload: { id: 1 },
            occurredAt: new Date("2026-06-11T10:00:00.000Z"),
            persistedAt: new Date("2026-06-11T10:00:01.000Z"),
            tenantKey: "tenant-1",
            userId: "user-1",
            correlationId: null,
            dedupeKey: null,
            identityClaim: null,
            chatBinding: null,
            relayStatus: "committed",
        };

        appCtx.events = {
            enabled: true,
            signalStore: {
                list: async () => [signal],
                get: async (signalId: string) => (signalId === signal.signalId ? signal : null),
            },
            signalQueue: {
                enqueue: async (signalId: string) => `queue:${signalId}`,
            },
        };

        const { router } = await import("../../src/routers/signals.js");
        const app = Fastify();
        await app.register(router);
        await app.ready();

        const userRes = await app.inject({
            method: "GET",
            url: "/signals",
            headers: { authorization: "Bearer user-token" },
        });
        expect(userRes.statusCode).toBe(404);

        const adminRes = await app.inject({
            method: "GET",
            url: "/signals",
            headers: { authorization: "Bearer admin-token" },
        });
        expect(adminRes.statusCode).toBe(200);
        expect(adminRes.json()).toEqual({
            items: [
                {
                    signal_id: "sig-1",
                    type: "ticket.created",
                    source: "helpdesk",
                    payload: { id: 1 },
                    tenant_key: "tenant-1",
                    user_id: "user-1",
                    correlation_id: null,
                    dedupe_key: null,
                    identity_claim: null,
                    chat_binding: null,
                    occurred_at: "2026-06-11T10:00:00.000Z",
                    persisted_at: "2026-06-11T10:00:01.000Z",
                    relay_status: "committed",
                },
            ],
        });

        const replayRes = await app.inject({
            method: "POST",
            url: "/signals/sig-1/replay",
            headers: { authorization: "Bearer admin-token" },
        });
        expect(replayRes.statusCode).toBe(200);
        expect(replayRes.json().queue_msg_id).toBe("queue:sig-1");

        await app.close();
    });

    it("runs, schedules, jobs, and chat events expose the phase-7 event surface", async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.identityResolver = new TestIdentityResolver();

        const runs = new Map<string, JobRun>();
        const baseRun: JobRun = {
            runId: "run-1",
            spec: {
                triggerId: "trigger-1",
                signalId: "sig-1",
                agentName: "support",
                prompt: "Handle signal",
                identityClaim: {},
                correlationId: null,
                parallelismKey: "tenant-1",
                visibility: "user",
                visibilityUserId: "user-1",
                chatBinding: { chat_id: "chat-1" },
                proactiveChat: false,
            },
            attemptNumber: 1,
            status: JobStatus.RUNNING,
            queuedAt: new Date("2026-06-11T10:00:00.000Z"),
            startedAt: new Date("2026-06-11T10:00:05.000Z"),
            finishedAt: null,
            result: null,
            error: null,
            nextRetryAt: null,
            metadata: { tenant_key: "tenant-1" },
        };
        runs.set(baseRun.runId, baseRun);

        const schedules = new Map<string, OrchidScheduleRecord>();
        schedules.set("schedule-1", {
            scheduleId: "schedule-1",
            triggerId: "trigger-1",
            cron: "0 * * * *",
            intervalSeconds: null,
            identityClaim: {},
            lastFireAt: null,
            nextFireAt: null,
            enabled: true,
        });

        appCtx.orchid = {
            chatStorage: {
                getChat: async (chatId: string) =>
                    chatId === "chat-1"
                        ? {
                              id: "chat-1",
                              title: "Test",
                              tenantId: "tenant-1",
                              userId: "user-1",
                              createdAt: new Date(),
                              updatedAt: new Date(),
                              isShared: false,
                          }
                        : null,
            },
            runtime: {
                chatStorage: null,
            },
            close: async () => {},
        } as unknown as NonNullable<typeof appCtx.orchid>;

        let producerRefreshed = 0;
        appCtx.events = {
            enabled: true,
            triggerRegistry: {
                all: () => [
                    {
                        triggerId: "trigger-1",
                        parallelism: "per_user",
                        visibility: "user",
                        respectChatBinding: true,
                    },
                ],
                get: (triggerId: string) => (triggerId === "trigger-1" ? { triggerId } : null),
            },
            jobStore: {
                list: async (options?: { triggerId?: string; chatBindingChatId?: string }) => {
                    const values = Array.from(runs.values());
                    if (options?.triggerId) {
                        return values.filter((run) => run.spec.triggerId === options.triggerId);
                    }
                    if (options?.chatBindingChatId) {
                        return values.filter(
                            (run) =>
                                run.spec.chatBinding?.["chat_id"] === options.chatBindingChatId,
                        );
                    }
                    return values;
                },
                get: async (runId: string) => runs.get(runId) ?? null,
                update: async (run: JobRun) => {
                    runs.set(run.runId, run);
                },
            },
            scheduleStore: {
                list: async () => Array.from(schedules.values()),
                get: async (scheduleId: string) => schedules.get(scheduleId) ?? null,
                upsert: async (record: OrchidScheduleRecord) => {
                    schedules.set(record.scheduleId, record);
                },
            },
            signalQueue: {
                enqueue: async (signalId: string) => `queued:${signalId}`,
            },
            eventStream: {
                async *subscribeRun(runId: string) {
                    yield {
                        type: "bloom.run.finished",
                        runId,
                        occurredAt: new Date("2026-06-11T10:05:00.000Z"),
                        payload: { status: "done" },
                    };
                },
                async *subscribe(channel: string) {
                    yield {
                        type: "chat.bloom.tick",
                        chatId: channel.replace("chat:", ""),
                        runId: "run-1",
                        occurredAt: new Date("2026-06-11T10:04:00.000Z"),
                        payload: { progress: 50 },
                    };
                },
            },
            producers: [
                {
                    refresh: async () => {
                        producerRefreshed += 1;
                    },
                },
            ],
        };

        const { router: jobsRouter } = await import("../../src/routers/jobs.js");
        const { router: runsRouter } = await import("../../src/routers/runs.js");
        const { router: schedulesRouter } = await import("../../src/routers/schedules.js");
        const { router: chatEventsRouter } = await import("../../src/routers/chatEvents.js");

        const app = Fastify();
        await app.register(jobsRouter);
        await app.register(runsRouter);
        await app.register(schedulesRouter);
        await app.register(chatEventsRouter);
        await app.ready();

        const jobsRes = await app.inject({
            method: "GET",
            url: "/jobs",
            headers: { authorization: "Bearer user-token" },
        });
        expect(jobsRes.statusCode).toBe(200);
        expect(jobsRes.json()).toEqual({
            items: [
                {
                    trigger_id: "trigger-1",
                    parallelism: "per_user",
                    visibility: "user",
                    respect_chat_binding: true,
                },
            ],
        });

        const runsRes = await app.inject({
            method: "GET",
            url: "/runs/run-1",
            headers: { authorization: "Bearer user-token" },
        });
        expect(runsRes.statusCode).toBe(200);
        expect(runsRes.json().run_id).toBe("run-1");

        const retryRes = await app.inject({
            method: "POST",
            url: "/runs/run-1/retry",
            headers: { authorization: "Bearer user-token" },
        });
        expect(retryRes.statusCode).toBe(200);
        expect(retryRes.json().queue_msg_id).toBe("queued:sig-1");

        const schedulesRes = await app.inject({
            method: "PATCH",
            url: "/schedules/schedule-1",
            headers: { authorization: "Bearer admin-token" },
            payload: { enabled: false },
        });
        expect(schedulesRes.statusCode).toBe(200);
        expect(schedulesRes.json().enabled).toBe(false);
        expect(producerRefreshed).toBe(1);

        const streamRes = await app.inject({
            method: "GET",
            url: "/runs/run-1/stream",
            headers: { authorization: "Bearer user-token" },
        });
        expect(streamRes.statusCode).toBe(200);
        expect(streamRes.body).toContain("bloom.run.finished");

        const chatEventsRes = await app.inject({
            method: "GET",
            url: "/chats/chat-1/events/stream",
            headers: { authorization: "Bearer user-token" },
        });
        expect(chatEventsRes.statusCode).toBe(200);
        expect(chatEventsRes.body).toContain("chat.bloom.attached");
        expect(chatEventsRes.body).toContain("chat.bloom.tick");

        await app.close();
    });
});
