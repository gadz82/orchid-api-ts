import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { getChatStorage } from "../context.js";
import { CreateChatRequestSchema } from "../models.js";
import { verifyChatOwnership } from "../helpers/state.js";

async function chatsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post("/chats", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage();
        const body = CreateChatRequestSchema.parse(request.body ?? {});
        const session = await chatRepo.createChat(
            auth.tenantKey,
            auth.userId,
            body.title || "New chat",
        );
        return reply.send({
            id: session.id,
            title: session.title,
            created_at:
                session.createdAt instanceof Date
                    ? session.createdAt.toISOString()
                    : String(session.createdAt),
            updated_at:
                session.updatedAt instanceof Date
                    ? session.updatedAt.toISOString()
                    : String(session.updatedAt),
            is_shared: session.isShared ?? false,
        });
    });

    fastify.get("/chats", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage();
        const sessions = await chatRepo.listChats(auth.tenantKey, auth.userId);
        return reply.send(
            sessions.map((s) => ({
                id: s.id,
                title: s.title,
                created_at:
                    s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
                updated_at:
                    s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
                is_shared: s.isShared ?? false,
            })),
        );
    });

    fastify.get("/chats/:chatId/messages", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage();
        const params = request.params as { chatId: string };
        const query = request.query as { limit?: string; offset?: string };
        const limit = Math.min(parseInt(query.limit || "50", 10), 500);
        const offset = parseInt(query.offset || "0", 10);

        await verifyChatOwnership(params.chatId, auth, chatRepo);

        const messages = await chatRepo.getMessages(params.chatId, limit, offset);
        return reply.send(
            messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                agents_used: m.agentsUsed ?? [],
                created_at:
                    m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
                metadata: (m as { metadata?: Record<string, unknown> }).metadata ?? null,
            })),
        );
    });

    fastify.delete("/chats/:chatId", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage();
        const params = request.params as { chatId: string };

        await verifyChatOwnership(params.chatId, auth, chatRepo);
        await chatRepo.deleteChat(params.chatId);

        return reply.send({ status: "deleted", chat_id: params.chatId });
    });
}

export const router = fp(chatsRouter, { name: "chats" });
