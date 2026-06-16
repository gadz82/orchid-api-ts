import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";

// Set dev auth bypass to skip real auth
process.env["DEV_AUTH_BYPASS"] = "true";

// Mock chat storage
let mockChats: Array<{
    id: string;
    title: string;
    tenantId: string;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    isShared: boolean;
}> = [];
let mockMessages: Array<{
    id: string;
    role: string;
    content: string;
    agentsUsed: string[];
    createdAt: Date;
}> = [];

async function buildTestApp(): Promise<FastifyInstance> {
    const app = Fastify();

    // Mock the context with a chat storage implementation
    const { appCtx } = await import("../../src/context.js");
    appCtx.orchid = {
        chatStorage: {
            createChat: async (tenantId: string, userId: string, title: string) => {
                const chat = {
                    id: `chat-${mockChats.length + 1}`,
                    title,
                    tenantId,
                    userId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isShared: false,
                };
                mockChats.push(chat);
                return chat;
            },
            listChats: async (tenantId: string, userId: string) => {
                return mockChats.filter((c) => c.tenantId === tenantId && c.userId === userId);
            },
            getChat: async (chatId: string) => {
                return mockChats.find((c) => c.id === chatId) || null;
            },
            deleteChat: async (chatId: string) => {
                mockChats = mockChats.filter((c) => c.id !== chatId);
            },
            getMessages: async (_chatId: string) => {
                return mockMessages;
            },
            addMessage: async () => {
                return {
                    id: "msg-1",
                    role: "user",
                    content: "test",
                    agentsUsed: [],
                    createdAt: new Date(),
                };
            },
            updateTitle: async () => {},
            markShared: async () => {},
            initDb: async () => {},
            close: async () => {},
        },
        runtime: {
            config: { agents: {} },
            chatStorage: null,
        },
        close: async () => {},
    } as unknown as NonNullable<typeof appCtx.orchid>;

    // Register chats router
    const { router } = await import("../../src/routers/chats.js");
    await app.register(router);

    await app.ready();
    return app;
}

describe("chats router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        mockChats = [];
        mockMessages = [];
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("POST /chats creates a new chat", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/chats",
            payload: { title: "My test chat" },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBeDefined();
        expect(body.title).toBe("My test chat");
        expect(body.is_shared).toBe(false);
    });

    it("POST /chats defaults title", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.title).toBe("New chat");
    });

    it("GET /chats lists user's chats", async () => {
        // Create one first
        await app.inject({
            method: "POST",
            url: "/chats",
            payload: { title: "Test 1" },
        });

        const res = await app.inject({
            method: "GET",
            url: "/chats",
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /chats/:id/messages returns messages", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: { title: "Test" },
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "GET",
            url: `/chats/${chat.id}/messages`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });

    it("DELETE /chats/:id deletes a chat", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "DELETE",
            url: `/chats/${chat.id}`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("deleted");
        expect(body.chat_id).toBe(chat.id);
    });

    it("GET /chats/:id/messages returns 404 for missing chat", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/chats/nonexistent/messages",
        });
        expect(res.statusCode).toBe(404);
    });

    it("GET /chats/:id/messages defaults limit/offset", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "GET",
            url: `/chats/${chat.id}/messages`,
        });
        expect(res.statusCode).toBe(200);
    });
});
