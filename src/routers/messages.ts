import { randomUUID } from "node:crypto";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { getChatStorage, getMCPTokenStoreOptional } from "../context.js";
import { ChatResponseSchema } from "../models.js";
import {
    prepareGraphState,
    verifyChatOwnership,
    buildInterruptResponse,
    autoTitleIfFirstMessage,
} from "../helpers/state.js";
import { createRateLimit } from "../rateLimit.js";
import { getSettings } from "../settings.js";
import { getOrchid } from "../context.js";

const settings = getSettings();
const messagesRateLimit = createRateLimit("messages", settings.rate_limit_messages_per_minute, 60);
const uploadsRateLimit = createRateLimit("uploads", settings.rate_limit_uploads_per_minute, 60);

async function messagesRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    // Send message (multipart/form-data)
    fastify.post<{ Params: { chatId: string } }>(
        "/chats/:chatId/messages",
        { preHandler: [messagesRateLimit] },
        async (request) => {
            const auth = getAuthContext(request);
            const chatRepo = getChatStorage();
            const orchid = getOrchid();
            const params = request.params as { chatId: string };
            const mcpTokenStore = getMCPTokenStoreOptional();

            // Parse body — supports both JSON and multipart
            const data = await request.body;
            const body = data as { message?: string | { value: string }; files?: unknown[] };

            const messageRaw = body?.message;
            const message =
                typeof messageRaw === "string"
                    ? messageRaw
                    : ((messageRaw as { value?: string })?.value ?? "");
            if (!message) {
                throw Object.assign(new Error("Message is required"), { statusCode: 400 });
            }

            await verifyChatOwnership(params.chatId, auth, chatRepo);

            const files: Array<{ filename: string; data: Buffer; mimetype: string }> = [];

            const prepared = await prepareGraphState(
                params.chatId,
                message,
                files,
                auth,
                settings,
                chatRepo,
                { reader: (orchid as unknown as { reader?: unknown }).reader },
                mcpTokenStore,
            );

            const config = {
                configurable: {
                    auth_context: auth,
                    thread_id: params.chatId,
                    request_id: randomUUID().slice(0, 8),
                },
            };

            try {
                const graph = (
                    orchid as unknown as {
                        graph?: {
                            ainvoke(
                                state: unknown,
                                config: unknown,
                            ): Promise<Record<string, unknown>>;
                        };
                    }
                ).graph;
                if (!graph) {
                    throw Object.assign(new Error("Graph not initialised"), { statusCode: 503 });
                }

                const result = await graph.ainvoke(prepared.initialState, config);
                const responseText =
                    ((result as Record<string, unknown>)["final_response"] as string) ||
                    "No response generated.";
                const agentsUsed =
                    ((result as Record<string, unknown>)["active_agents"] as string[]) || [];

                // Persist messages
                await chatRepo.addMessage(params.chatId, "user", prepared.message);
                await chatRepo.addMessage(params.chatId, "assistant", responseText, agentsUsed);
                await autoTitleIfFirstMessage(
                    params.chatId,
                    prepared.message,
                    prepared.historyRows,
                    chatRepo,
                );

                return ChatResponseSchema.parse({
                    response: responseText,
                    chat_id: params.chatId,
                    tenant_id: auth.tenantKey,
                    agents_used: agentsUsed,
                    auth_required: [],
                });
            } catch (exc) {
                if (exc instanceof Error && exc.name === "GraphInterrupt") {
                    return buildInterruptResponse(exc, params.chatId, auth.tenantKey);
                }

                try {
                    await chatRepo.addMessage(params.chatId, "user", prepared.message);
                } catch {
                    // Swallow
                }

                return ChatResponseSchema.parse({
                    response: "An error occurred while processing your request.",
                    chat_id: params.chatId,
                    tenant_id: auth.tenantKey,
                    agents_used: [],
                    auth_required: [],
                });
            }
        },
    );

    // Upload documents
    fastify.post<{ Params: { chatId: string } }>(
        "/chats/:chatId/upload",
        { preHandler: [uploadsRateLimit] },
        async (request, reply) => {
            const auth = getAuthContext(request);
            const chatRepo = getChatStorage();
            const params = request.params as { chatId: string };

            await verifyChatOwnership(params.chatId, auth, chatRepo);

            // Multipart file parsing
            const files: Array<{ filename: string; data: Buffer; mimetype: string }> = [];
            try {
                const body = request.body as AsyncIterable<unknown>;
                if (
                    body &&
                    typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
                ) {
                    for await (const part of body as AsyncIterable<{
                        file?: { filename: string; toBuffer(): Promise<Buffer> };
                        mimetype?: string;
                    }>) {
                        if (part.file) {
                            const name = part.file.filename;
                            if (name) {
                                files.push({
                                    filename: name,
                                    data: await part.file.toBuffer(),
                                    mimetype: part.mimetype || "application/octet-stream",
                                });
                            }
                        }
                    }
                }
            } catch {
                // No files or parse error
            }

            const maxSize = settings.upload_max_size_mb * 1024 * 1024;
            const results: Array<{
                filename: string;
                chunks_indexed: number | null;
                error: string | null;
            }> = [];

            for (const file of files) {
                if (file.data.length > maxSize) {
                    results.push({
                        filename: file.filename,
                        chunks_indexed: null,
                        error: `File too large (max ${settings.upload_max_size_mb}MB)`,
                    });
                    continue;
                }

                const safeName = path.basename(file.filename);
                try {
                    results.push({ filename: safeName, chunks_indexed: 0, error: null });
                    await chatRepo.addMessage(params.chatId, "system", `Uploaded ${safeName}`);
                } catch (exc) {
                    results.push({ filename: safeName, chunks_indexed: null, error: String(exc) });
                }
            }

            return reply.send({ status: "ok", files: results });
        },
    );
}

export const router = fp(messagesRouter, { name: "messages" });
