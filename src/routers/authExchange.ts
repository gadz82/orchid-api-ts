import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { getAuthExchangeClient } from "../context.js";

interface ExchangeCodeBody {
    code?: string;
    redirect_uri?: string;
    code_verifier?: string;
}

interface RefreshTokenBody {
    refresh_token?: string;
}

async function authExchangeRouter(fastify: FastifyInstance): Promise<void> {
    fastify.post("/auth/exchange-code", async (request, reply) => {
        const body = (request.body ?? {}) as ExchangeCodeBody;
        if (!body.code || !body.redirect_uri) {
            return reply.status(400).send({ detail: "code and redirect_uri are required" });
        }

        try {
            const exchangeClient = getAuthExchangeClient();
            const result = await exchangeClient.exchangeCode(
                body.code,
                body.redirect_uri,
                body.code_verifier,
            );

            return reply.send({
                access_token: result.accessToken,
                token_type: "Bearer",
                refresh_token: result.refreshToken ?? null,
                expires_in: result.expiresIn ?? null,
            });
        } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode ?? 503;
            const detail = error instanceof Error ? error.message : "OAuth exchange failed";
            return reply.status(statusCode).send({ detail });
        }
    });

    fastify.post("/auth/refresh-token", async (request, reply) => {
        const body = (request.body ?? {}) as RefreshTokenBody;
        if (!body.refresh_token) {
            return reply.status(400).send({ detail: "refresh_token is required" });
        }

        try {
            const exchangeClient = getAuthExchangeClient();
            const result = await exchangeClient.refreshToken(body.refresh_token);

            return reply.send({
                access_token: result.accessToken,
                token_type: "Bearer",
                expires_in: result.expiresIn ?? null,
            });
        } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode ?? 503;
            const detail = error instanceof Error ? error.message : "OAuth refresh failed";
            return reply.status(statusCode).send({ detail });
        }
    });
}

export const router = fp(authExchangeRouter, { name: "authExchange" });
