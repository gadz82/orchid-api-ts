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
import { applyCorsHeaders } from "../helpers/responseHeaders.js";

function extractContentFromMessage(msg: unknown): string {
    if (msg == null) return "";
    if (typeof msg === "string") return msg;
    if (typeof msg === "object") {
        const m = msg as Record<string, unknown>;
        const content = m["content"];
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === "string") return part;
                    if (part && typeof part === "object") {
                        const p = part as Record<string, unknown>;
                        if (typeof p["text"] === "string") return p["text"] as string;
                    }
                    return "";
                })
                .join("");
        }
    }
    return "";
}

function extractLastAiContent(messages: unknown): string {
    if (!Array.isArray(messages)) return "";
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as Record<string, unknown>;
        const t = m["type"] ?? m["role"];
        if (t === "ai" || t === "assistant") {
            return extractContentFromMessage(m);
        }
    }
    return "";
}

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
                const parts = request.parts();
                for await (const part of parts) {
                    if (
                        part.type !== "file" &&
                        part.fieldname === "message" &&
                        !message
                    ) {
                        message = String(part.value);
                    }
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
            };

            let fullResponse = "";

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

            try {
                // Call the underlying graph directly (Python parity — the
                // Python streaming router calls `graph.astream(prepared, ...)`
                // with the prepared state, bypassing the `Orchid` facade).
                //
                // The `Orchid.stream` facade was discarding the prepared
                // state: it only read `input.message` (a string) and rebuilt
                // a new state from scratch via `prepareInvocation`, which
                // dropped the human message injected by `prepareGraphState`.
                // The supervisor then ran with an empty `messages` array,
                // routed to "no agent" and produced an empty response.
                const graph = (orchid as unknown as { graph?: unknown }).graph;
                if (!graph) {
                    throw new Error("Agent graph not available at stream time");
                }
                const events = await (graph as {
                    stream(
                        state: unknown,
                        options: unknown,
                    ): Promise<AsyncIterable<[string, unknown]>>;
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
                    // `Pregel.stream()` in @langchain/langgraph 0.2.x yields
                    // values of different shapes depending on `streamMode`:
                    //   - `"values"`  — full state object
                    //   - `"updates"` — `{ [nodeName]: partialState }` delta
                    //   - `"messages"` — `[BaseMessage, metadata]` tuple
                    //   - `"custom"`  — opaque payload
                    // None of these are arrays, so destructuring as
                    // `[mode, payload]` throws "is not iterable" the
                    // moment the first chunk arrives. Handle each shape
                    // explicitly.
                    for await (const chunk of events as AsyncIterable<unknown>) {
                        if (chunk == null) continue;
                        if (Array.isArray(chunk)) {
                            // `streamMode: "messages"` tuple: [BaseMessage, metadata]
                            const [msg] = chunk as [unknown, unknown];
                            const content = extractContentFromMessage(msg);
                            if (content && content !== fullResponse) {
                                const delta = content.slice(fullResponse.length);
                                fullResponse = content;
                                reply.raw.write(eventToSSE(createChunkEvent(delta)));
                            }
                            continue;
                        }
                        if (typeof chunk !== "object") continue;
                        const obj = chunk as Record<string, unknown>;
                        // `streamMode: "values"` — chunk is the full state
                        if (
                            "messages" in obj ||
                            "final_response" in obj ||
                            "finalResponse" in obj
                        ) {
                            const content =
                                (obj["final_response"] as string) ||
                                (obj["finalResponse"] as string) ||
                                extractLastAiContent(obj["messages"]);
                            if (content && content !== fullResponse) {
                                const delta = content.slice(fullResponse.length);
                                fullResponse = content;
                                reply.raw.write(eventToSSE(createChunkEvent(delta)));
                            }
                            continue;
                        }
                        // `streamMode: "updates"` — chunk is { nodeName: partial }
                        // Emit the latest AI content from any of the partial states.
                        for (const partial of Object.values(obj)) {
                            if (!partial || typeof partial !== "object") continue;
                            const partialObj = partial as Record<string, unknown>;
                            const content =
                                (partialObj["final_response"] as string) ||
                                (partialObj["finalResponse"] as string) ||
                                extractLastAiContent(partialObj["messages"]);
                            if (content && content !== fullResponse) {
                                const delta = content.slice(fullResponse.length);
                                fullResponse = content;
                                reply.raw.write(eventToSSE(createChunkEvent(delta)));
                            }
                        }
                    }
                } catch (iterErr) {
                    request.log.warn(
                        { err: iterErr },
                        "stream iteration aborted (LLM error or stream closed early)",
                    );
                    if (!fullResponse) {
                        throw new Error(
                            "The graph stream was aborted before any events were produced. Check server logs for the supervisor / LLM error.",
                        );
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
                request.log.error({ err: exc }, "stream failed");
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
