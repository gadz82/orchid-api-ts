import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { getChatStorage } from "../context.js";
import { getOrchid } from "../context.js";
import {
    prepareGraphState,
    verifyChatOwnership,
    autoTitleIfFirstMessage,
} from "../helpers/state.js";
import {
    eventToSSE,
    createDoneEvent,
    createErrorEvent,
    createChunkEvent,
} from "../helpers/streamBuffer.js";
import { getSettings } from "../settings.js";

async function streamingRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post<{ Params: { chatId: string } }>(
        "/chats/:chatId/messages/stream",
        async (request, reply) => {
            const auth = getAuthContext(request);
            const chatRepo = getChatStorage();
            const orchid = getOrchid();
            const settings = getSettings();
            const params = request.params as { chatId: string };

            const body = request.body as { message?: string } | undefined;
            const message = body?.message ?? "";

            if (!message) {
                reply.status(400).send({ detail: "Message is required" });
                return;
            }

            await verifyChatOwnership(params.chatId, auth, chatRepo);

            const prepared = await prepareGraphState(
                params.chatId,
                message,
                [],
                auth,
                settings,
                chatRepo,
                { reader: (orchid as unknown as { reader?: unknown }).reader },
                null,
            );

            reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });

            const config = {
                configurable: {
                    auth_context: auth,
                    thread_id: params.chatId,
                    request_id: randomUUID().slice(0, 8),
                },
            };

            let fullResponse = "";

            try {
                const stream = (
                    orchid as unknown as {
                        stream(
                            state: unknown,
                            config: unknown,
                        ): Promise<AsyncIterable<[string, unknown]>>;
                    }
                ).stream;
                const events = await stream(prepared.initialState, config);

                for await (const [mode, payload] of events) {
                    if (mode === "values") {
                        const p = payload as Record<string, unknown>;
                        const content = (p["final_response"] as string) || "";
                        if (content && content !== fullResponse) {
                            const delta = content.slice(fullResponse.length);
                            fullResponse = content;
                            reply.raw.write(eventToSSE(createChunkEvent(delta)));
                        }
                    } else if (mode === "custom") {
                        reply.raw.write(eventToSSE({ data: JSON.stringify(payload) }));
                    }
                }

                await chatRepo.addMessage(params.chatId, "user", prepared.message);
                await chatRepo.addMessage(
                    params.chatId,
                    "assistant",
                    fullResponse || "No response generated.",
                );
                await autoTitleIfFirstMessage(
                    params.chatId,
                    prepared.message,
                    prepared.historyRows,
                    chatRepo,
                );

                reply.raw.write(eventToSSE(createDoneEvent()));
            } catch (exc) {
                reply.raw.write(eventToSSE(createErrorEvent(String(exc))));
                reply.raw.write(eventToSSE(createDoneEvent()));
            } finally {
                reply.raw.end();
            }
        },
    );

    fastify.get("/chats/capabilities", async (_request, reply) => {
        return reply.send({
            streaming: true,
            models: [getSettings().litellm_model],
        });
    });
}

export const router = fp(streamingRouter, { name: "streaming" });
