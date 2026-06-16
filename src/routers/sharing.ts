import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { getChatStorage } from "../context.js";
import { verifyChatOwnership } from "../helpers/state.js";

async function sharingRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post<{ Params: { chatId: string } }>("/chats/:chatId/share", async (request, reply) => {
        const auth = getAuthContext(request);
        const chatRepo = getChatStorage();
        const params = request.params as { chatId: string };

        await verifyChatOwnership(params.chatId, auth, chatRepo);
        await chatRepo.markShared(params.chatId);

        return reply.send({ status: "shared", chat_id: params.chatId });
    });
}

export const router = fp(sharingRouter, { name: "sharing" });
