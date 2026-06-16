import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";

async function buildTestApp(): Promise<FastifyInstance> {
    const app = Fastify();

    process.env["DEV_AUTH_BYPASS"] = "true";

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
            initDb: async () => {},
            close: async () => {},
        },
        runtime: {
            config: { agents: {} },
            chatStorage: null,
            mcpAuthRegistry: {
                oauthServers: new Map(),
            },
            mcpTokenStore: {
                listTokens: async () => [],
                getToken: async () => null,
                deleteToken: async () => true,
                initDb: async () => {},
                close: async () => {},
            },
            mcpClientRegistrationStore: null,
        },
        sessionWarmer: {
            warmForUser: async () => {},
            isWarmed: () => false,
        },
        close: async () => {},
    } as unknown as NonNullable<typeof appCtx.orchid>;

    appCtx.oauthStateStore = {
        getState: async () => null,
        setState: async () => {},
        deleteState: async () => {},
    } as unknown as NonNullable<typeof appCtx.oauthStateStore>;

    const { router: sessionRouter } = await import("../../src/routers/session.js");
    const { router: mcpAuthRouter } = await import("../../src/routers/mcpAuth.js");
    const { router: chatsRouter } = await import("../../src/routers/chats.js");

    await app.register(
        fp(async (f) => {
            await chatsRouter(f);
        }),
    );
    await app.register(sessionRouter);
    await app.register(mcpAuthRouter);

    await app.ready();
    return app;
}

describe("session router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("POST /session/warm returns ok", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/session/warm",
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("ok");
    });
});

describe("mcp auth router", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await buildTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it("GET /mcp/auth/servers lists servers", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/mcp/auth/servers",
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it("DELETE /mcp/auth/servers/:name/token returns 204", async () => {
        const res = await app.inject({
            method: "DELETE",
            url: "/mcp/auth/servers/test-server/token",
        });
        expect(res.statusCode).toBe(204);
    });
});
