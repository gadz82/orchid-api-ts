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
            markShared: async (chatId: string) => {
                const chat = chats.get(chatId);
                if (chat) {
                    chat.isShared = true;
                }
            },
            deleteChat: async (chatId: string) => {
                chats.delete(chatId);
            },
            initDb: async () => {},
            close: async () => {},
        },
        runtime: {
            config: { agents: {} },
            chatStorage: null,
        },
        close: async () => {},
    } as unknown as NonNullable<typeof appCtx.orchid>;

    const { router } = await import("../../src/routers/sharing.js");
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

describe("sharing router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("POST /chats/:id/share marks chat as shared", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/chats",
            payload: {},
        });
        const chat = JSON.parse(createRes.body);

        const res = await app.inject({
            method: "POST",
            url: `/chats/${chat.id}/share`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("shared");
        expect(body.chat_id).toBe(chat.id);
    });
});
