import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { resolveAuthContext, getAuthContext } from "../auth.js";
import { appCtx } from "../context.js";

async function sessionRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", resolveAuthContext);

    fastify.post("/session/warm", async (request, reply) => {
        const auth = getAuthContext(request);

        if (!appCtx.orchid) {
            return reply.status(503).send({ detail: "Orchid not initialised" });
        }

        const warmer = (
            appCtx.orchid as unknown as {
                sessionWarmer?: { warmForUser(auth: unknown): Promise<unknown> };
            }
        ).sessionWarmer;

        if (warmer) {
            try {
                await warmer.warmForUser(auth);
            } catch {
                // Swallow — warm failures never abort requests
            }
        }

        return reply.send({ status: "ok" });
    });
}

export const router = fp(sessionRouter, { name: "session" });
