import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

async function diagnosticsRouter(fastify: FastifyInstance): Promise<void> {
    fastify.get("/health", { logLevel: "silent" }, async (_request, reply) => {
        return reply.send({ status: "ok", version: "0.1.0" });
    });
}

export const router = fp(diagnosticsRouter, { name: "diagnostics" });
