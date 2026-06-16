import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { getOrchid } from "../context.js";
import { ChatResponseSchema } from "../models.js";

async function resumeRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post<{ Params: { chatId: string } }>(
        "/chats/:chatId/resume",
        async (request, reply) => {
            const auth = getAuthContext(request);
            const orchid = getOrchid();
            const params = request.params as { chatId: string };
            const body = request.body as {
                tool?: string;
                args?: Record<string, unknown>;
                agent?: string;
                approved?: boolean;
                interrupt_id?: string;
                approvals?: Array<{
                    tool: string;
                    args: Record<string, unknown>;
                    agent: string;
                    approved: boolean;
                    interrupt_id: string;
                }>;
            };

            const approvals = body?.approvals || [
                {
                    tool: body?.tool || "",
                    args: body?.args || {},
                    agent: body?.agent || "",
                    approved: body?.approved ?? true,
                    interrupt_id: body?.interrupt_id || "",
                },
            ];

            if (approvals.length === 0) {
                return reply.status(400).send({ detail: "At least one approval is required" });
            }

            const resumeFn = (
                orchid as unknown as {
                    resume(
                        threadId: string,
                        approval: unknown,
                        config?: unknown,
                    ): Promise<{
                        response: string;
                        chatId: string;
                        agentsUsed: string[];
                        messages: unknown[];
                    }>;
                }
            ).resume;

            for (const approval of approvals) {
                const result = await resumeFn(params.chatId, {
                    tool: approval.tool,
                    args: approval.args,
                    agent: approval.agent,
                    approved: approval.approved,
                });

                // Return response from last approval (or aggregate)
                if (approval === approvals[approvals.length - 1]) {
                    return reply.send(
                        ChatResponseSchema.parse({
                            response: result.response,
                            chat_id: result.chatId,
                            tenant_id: auth.tenantKey,
                            agents_used: result.agentsUsed,
                            auth_required: [],
                        }),
                    );
                }
            }
        },
    );
}

export const router = fp(resumeRouter, { name: "resume" });
