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
    processStreamChunk,
    createStreamProcessingState,
} from "../helpers/streamBuffer.js";
import { getSettings } from "../settings.js";
import { applyCorsHeaders } from "../helpers/responseHeaders.js";

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

            const contentType = request.headers["content-type"] ?? "";
            let message = "";
            if (contentType.startsWith("multipart/form-data")) {
                try {
                    const parts = request.parts();
                    for await (const part of parts) {
                        if (
                            part.type !== "file" &&
                            part.fieldname === "message" &&
                            !message
                        ) {
                            message = String(part.value);
                        }
                        // Consume file parts to prevent stream hang
                        if (part.type === "file" && part.file) {
                            try {
                                // Drain the file stream
                                for await (const _chunk of part.file) {
                                    // Discard chunks
                                }
                            } catch {
                                // Ignore file consumption errors
                            }
                        }
                    }
                } catch {
                    // Multipart parse error or no parts
                }
            } else {
                const body = request.body as { message?: string } | undefined;
                message = body?.message ?? "";
            }

            if (!message) {
                reply.status(400).send({ detail: "Message is required" });
                return;
            }

            await verifyChatOwnership(params.chatId, auth, chatRepo);

            const hasCheckpointer = !!((orchid.runtime as unknown as { checkpointer?: unknown }).checkpointer);

            const prepared = await prepareGraphState(
                params.chatId,
                message,
                [],
                auth,
                settings,
                chatRepo,
                { reader: (orchid as unknown as { reader?: unknown }).reader },
                null,
                hasCheckpointer,
            );

            applyCorsHeaders(reply);
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
                streamMode: "updates",
            };

            // Fail fast with a visible error event if the agent graph never
            // compiled (e.g. buildGraph() threw at startup and the facade
            // swallowed it). Without this guard the stream() call below would
            // throw a cryptic "Cannot read properties of null" deep inside
            // the invoker, which the user only sees as an empty response.
            const graph = (orchid as unknown as { graph?: unknown }).graph;
            if (!graph) {
                request.log.error(
                    "Agent graph not available — buildGraph() failed at startup. Check server logs.",
                );
                reply.raw.write(
                    eventToSSE(
                        createErrorEvent(
                            "Agent graph not available. The server failed to compile the agent graph at startup; check the API logs for the buildGraph error.",
                        ),
                    ),
                );
                reply.raw.write(eventToSSE(createDoneEvent()));
                reply.raw.end();
                return;
            }

            const streamState = createStreamProcessingState();

            try {
                const events = await (graph as {
                    stream(
                        state: unknown,
                        options: unknown,
                    ): Promise<AsyncIterable<unknown>>;
                }).stream(prepared.initialState, config);

                // Guard against `events` being undefined / non-iterable. The
                // graph can resolve with a non-iterable when it failed at
                // compile time and we're holding the stub, or when stream()
                // throws inside LangGraph before yielding anything.
                if (events == null || typeof (events as any)[Symbol.asyncIterator] !== "function") {
                    throw new Error(
                        "Graph stream produced no iterable events. Check server logs for the supervisor / LLM error.",
                    );
                }

                // Wrap the iteration in its own try/catch. LangGraph's
                // `IterableReadableStream` can throw synchronously when the
                // underlying stream is aborted (e.g. the LLM call fails
                // and the supervisor errors out), throwing "not iterable"
                // before any events are yielded. We surface that as a
                // proper error SSE event instead of crashing the handler.
                try {
                    for await (const chunk of events as AsyncIterable<unknown>) {
                        const chunkEvents = processStreamChunk(chunk, streamState);
                        for (const event of chunkEvents) {
                            reply.raw.write(eventToSSE(event));
                        }
                    }
                } catch (iterErr) {
                    request.log.warn(
                        { err: iterErr },
                        "stream iteration aborted (LLM error or stream closed early)",
                    );
                    if (!streamState.fullResponse) {
                        throw new Error(
                            "The graph stream was aborted before any events were produced. Check server logs for the supervisor / LLM error.",
                        );
                    }
                }

                await chatRepo.addMessage(params.chatId, "user", prepared.message);
                await chatRepo.addMessage(
                    params.chatId,
                    "assistant",
                    streamState.fullResponse || "No response generated.",
                );
                await autoTitleIfFirstMessage(
                    params.chatId,
                    prepared.message,
                    prepared.historyRows,
                    chatRepo,
                );

                reply.raw.write(
                    eventToSSE(
                        createDoneEvent(
                            streamState.fullResponse,
                            [...streamState.agentsUsed],
                            streamState.agentResults,
                        ),
                    ),
                );
            } catch (exc) {
                request.log.error({ err: exc }, "stream failed");
                reply.raw.write(eventToSSE(createErrorEvent(String(exc))));
                reply.raw.write(
                    eventToSSE(
                        createDoneEvent(
                            streamState.fullResponse,
                            [...streamState.agentsUsed],
                            streamState.agentResults,
                        ),
                    ),
                );
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
