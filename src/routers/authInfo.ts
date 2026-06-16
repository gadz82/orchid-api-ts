import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { OrchidAuthExchangeClient } from "@orchid-ai/orchid/core";

import { appCtx } from "../context.js";
import { getSettings } from "../settings.js";

async function authInfoRouter(fastify: FastifyInstance): Promise<void> {
    fastify.get("/auth-info", async (request, reply) => {
        const domain =
            typeof request.query === "object" && request.query
                ? (request.query as { domain?: string }).domain
                : undefined;

        let oauth: Record<string, unknown> | null = null;
        if (appCtx.authConfigProvider) {
            const resolved = appCtx.authConfigProvider.resolveConfig();
            oauth = {
                auth_domain: domain ?? resolved.domain,
                authorization_endpoint: resolved.authorizationEndpoint ?? null,
                token_endpoint: resolved.tokenEndpoint ?? null,
                client_id: resolved.clientId,
                scope: resolved.scopes,
                exchange_via_api: appCtx.authExchangeClient !== null,
                refresh_via_api:
                    appCtx.authExchangeClient !== null &&
                    Object.getPrototypeOf(appCtx.authExchangeClient).refreshToken !==
                        OrchidAuthExchangeClient.prototype.refreshToken,
                resolve_via_api: appCtx.identityResolver !== null,
            };
        }

        return reply.send({
            dev_bypass: getSettings().dev_auth_bypass,
            identity_resolver_configured: appCtx.identityResolver !== null,
            oauth,
        });
    });
}

export const router = fp(authInfoRouter, { name: "authInfo" });
