import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext } from "../auth.js";
import { createRateLimit } from "../rateLimit.js";
import { getSettings } from "../settings.js";

const indexRateLimit = createRateLimit("index", getSettings().rate_limit_index_per_minute, 60);

async function adminRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post("/index", { preHandler: [indexRateLimit] }, async (_request, reply) => {
        const settings = getSettings();

        if (!settings.allow_index_endpoint) {
            return reply.status(403).send({ detail: "Index endpoint is disabled" });
        }

        return reply.send({
            status: "ok",
            tenant_id: "default",
            indexed: {},
        });
    });
}

export const router = fp(adminRouter, { name: "admin" });
