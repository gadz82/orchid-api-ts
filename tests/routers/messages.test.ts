import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";

async function buildTestApp(): Promise<FastifyInstance> {
    const app = Fastify();

    process.env["DEV_AUTH_BYPASS"] = "true";

    const chats = new Map<
        string,
        {
            id: string;
            title: string;
            tenantId: string;
            userId: string;
            createdAt: Date;
            updatedAt: Date;
            isShared: boolean;
        }
    >();
    let chatCounter = 0;

    // Mock context
    const { appCtx } = await import("../../src/context.js");
    appCtx.orchid = {
        chatStorage: {
            createChat: async (tenantId: string, userId: string, title: string) => {
                chatCounter += 1;
                const chat = {
                    id: `c${chatCounter}`,
                    title,
                    tenantId,
                    userId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isShared: false,
                };
                chats.set(chat.id, chat);
                return chat;
            },
            listChats: async () => Array.from(chats.values()),
            getChat: async (chatId: string) => chats.get(chatId) ?? null,
            getMessages: async () => [],
            addMessage: async () => ({
                id: "m1",
                role: "user",
                content: "test",
                agentsUsed: [],
                createdAt: new Date(),
            }),
            updateTitle: async () => {},
            deleteChat: async (chatId: string) => {
                chats.delete(chatId);
            },
            initDb: async () => {},
            close: async () => {},
        } as unknown as NonNullable<typeof appCtx.orchid>["chatStorage"],
        graph: {
            ainvoke: async () => ({
                final_response: "Hello from agent!",
                active_agents: ["test-agent"],
            }),
        },
        runtime: {
            config: { agents: { "test-agent": {} } },
            chatStorage: null,
        },
        reader: null,
        close: async () => {},
    } as unknown as NonNullable<typeof appCtx.orchid>;

    const { router } = await import("../../src/routers/messages.js");
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

describe("messages router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("POST /chats/:id/messages sends a message", async () => {
        // First create a chat to own
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages`,
            payload: { message: "Hello, world!" },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.response).toBeDefined();
        expect(body.chat_id).toBe(chat.id);
        expect(body.tenant_id).toBe("99999");
    });

    it("POST /chats/:id/messages returns 400 with empty message", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/messages`,
            payload: { message: "" },
        });
        expect(res.statusCode).toBe(400);
    });

    it("POST /chats/:id/upload returns ok", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/upload`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("ok");
        expect(Array.isArray(body.files)).toBe(true);
    });

    it("POST /chats/nonexistent/messages returns 404", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/chats/nonexistent/messages",
            payload: { message: "test" },
        });
        expect(res.statusCode).toBe(404);
    });
});
