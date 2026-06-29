import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { OrchidAuthContext } from "@orchid-ai/orchid/core";

async function buildTestApp(opts?: {
    stream?: () => AsyncIterable<unknown>;
    messages?: { role: string; content: string }[];
}): Promise<FastifyInstance> {
    const app = Fastify();

    process.env["DEV_AUTH_BYPASS"] = "true";

    // Mock context
    const { appCtx } = await import("../../src/context.js");
    appCtx.orchid = {
        chatStorage: {
            getChat: async () => ({
                id: "c1",
                title: "Test",
                tenantId: "99999",
                userId: "dev-user-00000000",
                createdAt: new Date(),
                updatedAt: new Date(),
                isShared: false,
            }),
            getMessages: async () => opts?.messages ?? [],
            addMessage: async () => ({
                id: "m1",
                role: "user",
                content: "test",
                agentsUsed: [],
                createdAt: new Date(),
            }),
            updateTitle: async () => {},
            initDb: async () => {},
            close: async () => {},
        },
        graph: {
            stream: opts?.stream ?? (async function* () {
                yield {
                    supervisor: {
                        messages: [{ role: "ai", content: "Hello streaming!" }],
                        finalResponse: "Hello streaming!",
                    },
                };
            }),
        },
        runtime: {
            config: { agents: {} },
            chatStorage: null,
        },
        reader: null,
        close: async () => {},
    } as unknown as NonNullable<typeof appCtx.orchid>;

    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

    const { router } = await import("../../src/routers/streaming.js");
    const { router: chatsRouter } = await import("../../src/routers/chats.js");

    await app.register(
        fp(async (f) => {
            await chatsRouter(f);
        }),
    );
    await app.register(router);

    await app.ready();
    return app;
}

describe("streaming router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("POST /chats/:id/messages/stream returns SSE stream", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: { message: "Stream this" },
        });
        // Streaming endpoint uses raw reply, so status may differ
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('data: {"type":"token","content":"Hello streaming!"}');
        expect(res.body).toContain('"type":"done"');
    });

    it("GET /chats/capabilities returns capabilities", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/chats/capabilities",
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.streaming).toBe(true);
        expect(Array.isArray(body.models)).toBe(true);
    });

    it("POST /chats/:id/messages/stream requires message", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it("POST /chats/:id/messages/stream parses multipart message", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const boundary = "----test-boundary";
        const body =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="message"\r\n\r\n` +
            `Hello from multipart\r\n` +
            `--${boundary}--\r\n`;

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: body,
            headers: {
                "content-type": `multipart/form-data; boundary=${boundary}`,
            },
        });
        expect(res.statusCode).toBe(200);
    });

    it("POST /chats/:id/messages/stream surfaces a visible error when the agent graph is missing", async () => {
        const { appCtx } = await import("../../src/context.js");
        // Simulate the buildGraph-failed state: graph is null but stream()
        // is still callable (it would throw a cryptic TypeError otherwise).
        appCtx.orchid = {
            ...appCtx.orchid,
            graph: null,
        } as unknown as NonNullable<typeof appCtx.orchid>;

        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: { message: "hello" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Agent graph not available");
    });

    it("does not replay prior assistant responses on follow-up turns", async () => {
        const priorAssistant = "Previous turn response";
        app = await buildTestApp({
            messages: [
                { role: "user", content: "First question" },
                { role: "assistant", content: priorAssistant },
            ],
            stream: async function* () {
                // Simulate updates mode: each chunk is the delta written by
                // a single node.  The supervisor routing step does not
                // include the old assistant message.
                yield {
                    supervisor: {
                        messages: [{ role: "ai", content: "[Supervisor] Parallel dispatch: basketball" }],
                        activeAgents: ["basketball"],
                        pendingAgents: [],
                        executionMode: "parallel",
                    },
                };
                yield {
                    basketball_agent: {
                        messages: [
                            { role: "ai", content: "[Basketball Agent] New turn answer" },
                        ],
                        activeAgents: [],
                    },
                };
                yield {
                    supervisor: {
                        messages: [{ role: "ai", content: "New turn answer" }],
                        finalResponse: "New turn answer",
                        activeAgents: [],
                        pendingAgents: [],
                    },
                };
            },
        });

        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: { message: "Follow up" },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('"type":"token","content":"New turn answer"');
        expect(res.body).not.toContain(priorAssistant);
        expect(res.body).not.toContain("[Supervisor] Parallel dispatch");
    });
});

describe("streaming CORS", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        const { appCtx } = await import("../../src/context.js");
        appCtx.orchid = {
            chatStorage: {
                getChat: async () => ({
                    id: "c1",
                    title: "Test",
                    tenantId: "99999",
                    userId: "dev-user-00000000",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isShared: false,
                }),
                getMessages: async () => [],
                addMessage: async () => ({
                    id: "m1",
                    role: "user",
                    content: "test",
                    agentsUsed: [],
                    createdAt: new Date(),
                }),
                updateTitle: async () => {},
                initDb: async () => {},
                close: async () => {},
            },
            graph: {
                stream: async function* () {
                    yield {
                        supervisor: {
                            messages: [{ role: "ai", content: "ok" }],
                            finalResponse: "ok",
                        },
                    };
                },
            },
            runtime: { config: { agents: {} }, chatStorage: null },
            reader: null,
            close: async () => {},
        } as unknown as NonNullable<typeof appCtx.orchid>;

        app = Fastify();
        process.env["DEV_AUTH_BYPASS"] = "true";
        await app.register(cors, {
            origin: ["http://localhost:3000"],
            credentials: true,
        });

        const { router } = await import("../../src/routers/streaming.js");
        const { router: chatsRouter } = await import("../../src/routers/chats.js");
        await app.register(
            fp(async (f) => {
                await chatsRouter(f);
            }),
        );
        await app.register(router);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    it("preserves CORS headers when bypassing the response pipeline via reply.raw.writeHead", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages/stream`,
            payload: { message: "hello" },
            headers: { origin: "http://localhost:3000" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
        expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
});
