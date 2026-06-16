import { OrchidIdentityError } from "@orchid-ai/orchid/core";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { getIdentityResolver } from "../context.js";
import { getSettings } from "../settings.js";

interface ResolveIdentityBody {
    access_token?: string;
    auth_domain?: string;
}

async function authIdentityRouter(fastify: FastifyInstance): Promise<void> {
    fastify.post("/auth/resolve-identity", async (request, reply) => {
        const body = (request.body ?? {}) as ResolveIdentityBody;
        if (!body.access_token) {
            return reply.status(400).send({ detail: "access_token is required" });
        }

        try {
            const resolver = getIdentityResolver();
            const authDomain = body.auth_domain || getSettings().auth_domain;
            const authContext = await resolver.resolve(authDomain, body.access_token);
            const extra = { ...(authContext.extra ?? {}) };
            const email = typeof extra["email"] === "string" ? String(extra["email"]) : "";
            if ("email" in extra) {
                delete extra["email"];
            }

            return reply.send({
                subject: authContext.userId,
                bearer: authContext.accessToken,
                auth_domain: authDomain,
                email,
                extra,
            });
        } catch (error) {
            if (error instanceof OrchidIdentityError) {
                const statusCode = error.statusCode > 0 && error.statusCode < 500 ? 401 : 502;
                return reply.status(statusCode).send({ detail: error.message });
            }

            const statusCode = (error as { statusCode?: number }).statusCode ?? 503;
            const detail = error instanceof Error ? error.message : "Identity resolution failed";
            return reply.status(statusCode).send({ detail });
        }
    });
}

export const router = fp(authIdentityRouter, { name: "authIdentity" });
