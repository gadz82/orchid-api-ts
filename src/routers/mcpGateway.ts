import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext } from "../auth.js";
import { getOrchid } from "../context.js";

async function mcpGatewayRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.get("/mcp-gateway/config", async (_request, reply) => {
        const orchid = getOrchid();

        const config = (orchid as unknown as { config?: { mcpGateway?: unknown } }).config;

        return reply.send({
            tools: (config as { mcpGateway?: { tools?: unknown } })?.mcpGateway?.tools ?? {},
            prompts: (config as { mcpGateway?: { prompts?: unknown } })?.mcpGateway?.prompts ?? [],
        });
    });
}

export const router = fp(mcpGatewayRouter, { name: "mcpGateway" });
