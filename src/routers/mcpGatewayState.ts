import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { getMCPGatewayStateStore } from "../context.js";

async function mcpGatewayStateRouter(fastify: FastifyInstance): Promise<void> {
    const serviceToken = process.env["MCP_GATEWAY_STATE_SERVICE_TOKEN"];

    fastify.addHook("preHandler", async (_request, reply) => {
        if (!serviceToken) {
            return reply.status(503).send({ detail: "MCP gateway state endpoints are disabled" });
        }
        const auth = _request.headers.authorization;
        if (!auth || auth !== `Bearer ${serviceToken}`) {
            return reply.status(401).send({ detail: "Unauthorized" });
        }
    });

    fastify.post("/mcp-gateway/state/clients", async (request, reply) => {
        const body = request.body as {
            client_id: string;
            client_secret?: string;
            redirect_uris: string[];
            grant_types?: string[];
            token_endpoint_auth_method?: string;
            scope?: string;
            tenant_id?: string;
            metadata?: Record<string, unknown>;
            created_at?: number;
        };
        const store = getMCPGatewayStateStore();
        await store.register({
            clientId: body.client_id,
            clientSecret: body.client_secret,
            redirectUris: body.redirect_uris,
            grantTypes: body.grant_types,
            tokenEndpointAuthMethod: body.token_endpoint_auth_method,
            scope: body.scope,
            tenantId: body.tenant_id,
            metadata: body.metadata,
            createdAt: body.created_at,
        });
        return reply.status(204).send();
    });

    fastify.get("/mcp-gateway/state/clients/:clientId", async (request, reply) => {
        const params = request.params as { clientId: string };
        const store = getMCPGatewayStateStore();
        const record = await store.get(params.clientId);
        if (!record) {
            return reply.status(404).send({ detail: "client not found" });
        }
        return {
            client_id: record.clientId,
            client_secret: record.clientSecret ?? "",
            redirect_uris: record.redirectUris,
            grant_types: record.grantTypes ?? [],
            token_endpoint_auth_method: record.tokenEndpointAuthMethod ?? "none",
            scope: record.scope ?? "",
            tenant_id: record.tenantId ?? "",
            metadata: record.metadata ?? {},
            created_at: record.createdAt ?? 0,
        };
    });

    fastify.post("/mcp-gateway/state/auth-codes", async (request, reply) => {
        const body = request.body as {
            code: string;
            client_id: string;
            redirect_uri: string;
            scope?: string;
            code_challenge?: string;
            code_challenge_method?: string;
            upstream_state?: string;
            tenant_id?: string;
            user_id?: string;
            idp_access_token?: string;
            idp_refresh_token?: string;
            idp_expires_at?: number;
            expires_at: number;
            consumed?: boolean;
            created_at?: number;
        };
        const store = getMCPGatewayStateStore();
        await store.put({
            code: body.code,
            clientId: body.client_id,
            redirectUri: body.redirect_uri,
            scope: body.scope,
            codeChallenge: body.code_challenge,
            codeChallengeMethod: body.code_challenge_method,
            upstreamState: body.upstream_state,
            tenantId: body.tenant_id,
            userId: body.user_id,
            idpAccessToken: body.idp_access_token,
            idpRefreshToken: body.idp_refresh_token,
            idpExpiresAt: body.idp_expires_at,
            expiresAt: body.expires_at,
            consumed: body.consumed ?? false,
            createdAt: body.created_at,
        });
        return reply.status(204).send();
    });

    fastify.post(
        "/mcp-gateway/state/auth-codes/lookup-by-upstream-state",
        async (request, reply) => {
            const body = request.body as { upstream_state: string };
            const store = getMCPGatewayStateStore();
            const record = await store.getByUpstreamState(body.upstream_state);
            if (!record) {
                return reply.status(404).send({ detail: "auth code not found" });
            }
            return serialiseAuthCode(record);
        },
    );

    fastify.patch("/mcp-gateway/state/auth-codes/:code", async (request, reply) => {
        const params = request.params as { code: string };
        const patch = request.body as {
            tenant_id?: string;
            user_id?: string;
            idp_access_token?: string | null;
            idp_refresh_token?: string | null;
            idp_expires_at?: number | null;
            consumed?: boolean;
        };
        const store = getMCPGatewayStateStore();
        await store.update(params.code, {
            tenantId: patch.tenant_id,
            userId: patch.user_id,
            idpAccessToken: patch.idp_access_token ?? undefined,
            idpRefreshToken: patch.idp_refresh_token ?? undefined,
            idpExpiresAt: patch.idp_expires_at ?? undefined,
            consumed: patch.consumed,
        });
        return reply.status(204).send();
    });

    fastify.post("/mcp-gateway/state/auth-codes/:code/consume", async (request, reply) => {
        const params = request.params as { code: string };
        const store = getMCPGatewayStateStore();
        const record = await store.consume(params.code);
        if (!record) {
            return reply.status(404).send({ detail: "auth code not found" });
        }
        return serialiseAuthCode(record);
    });

    fastify.post("/mcp-gateway/state/tokens", async (request) => {
        const body = request.body as {
            access_token: string;
            refresh_token?: string;
            client_id: string;
            scope?: string;
            tenant_id?: string;
            user_id?: string;
            idp_access_token?: string;
            idp_refresh_token?: string;
            idp_expires_at?: number;
            expires_at?: number;
            created_at?: number;
        };
        const store = getMCPGatewayStateStore();
        const record = await store.issue({
            accessToken: body.access_token,
            refreshToken: body.refresh_token,
            clientId: body.client_id,
            scope: body.scope,
            tenantId: body.tenant_id,
            userId: body.user_id,
            idpAccessToken: body.idp_access_token,
            idpRefreshToken: body.idp_refresh_token,
            idpExpiresAt: body.idp_expires_at,
            expiresAt: body.expires_at,
            createdAt: body.created_at,
        });
        return serialiseToken(record);
    });

    fastify.post("/mcp-gateway/state/tokens/introspect", async (request, reply) => {
        const body = request.body as { access_token?: string; refresh_token?: string };
        const store = getMCPGatewayStateStore();
        const record = body.access_token
            ? await store.getByAccessToken(body.access_token)
            : body.refresh_token
              ? await store.getByRefreshToken(body.refresh_token)
              : null;
        if (!record) {
            return reply.status(404).send({ detail: "token not found" });
        }
        return serialiseToken(record);
    });

    fastify.delete("/mcp-gateway/state/tokens/:accessToken", async (request, reply) => {
        const params = request.params as { accessToken: string };
        const store = getMCPGatewayStateStore();
        const revoked = await store.revoke(params.accessToken);
        if (!revoked) {
            return reply.status(404).send({ detail: "token not found" });
        }
        return reply.status(204).send();
    });
}

export const router = fp(mcpGatewayStateRouter, { name: "mcpGatewayState" });

function serialiseAuthCode(record: {
    code: string;
    clientId: string;
    redirectUri: string;
    scope?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    upstreamState?: string;
    tenantId?: string;
    userId?: string;
    idpAccessToken?: string;
    idpRefreshToken?: string;
    idpExpiresAt?: number;
    expiresAt: number;
    consumed: boolean;
    createdAt?: number;
}): Record<string, unknown> {
    return {
        code: record.code,
        client_id: record.clientId,
        redirect_uri: record.redirectUri,
        scope: record.scope ?? "",
        code_challenge: record.codeChallenge ?? "",
        code_challenge_method: record.codeChallengeMethod ?? "S256",
        upstream_state: record.upstreamState ?? "",
        tenant_id: record.tenantId ?? "",
        user_id: record.userId ?? "",
        idp_access_token: record.idpAccessToken ?? "",
        idp_refresh_token: record.idpRefreshToken ?? "",
        idp_expires_at: record.idpExpiresAt ?? 0,
        expires_at: record.expiresAt,
        consumed: record.consumed,
        created_at: record.createdAt ?? 0,
    };
}

function serialiseToken(record: {
    accessToken: string;
    refreshToken?: string;
    clientId: string;
    scope?: string;
    tenantId?: string;
    userId?: string;
    idpAccessToken?: string;
    idpRefreshToken?: string;
    idpExpiresAt?: number;
    expiresAt?: number;
    createdAt?: number;
}): Record<string, unknown> {
    return {
        access_token: record.accessToken,
        refresh_token: record.refreshToken ?? "",
        client_id: record.clientId,
        scope: record.scope ?? "",
        tenant_id: record.tenantId ?? "",
        user_id: record.userId ?? "",
        idp_access_token: record.idpAccessToken ?? "",
        idp_refresh_token: record.idpRefreshToken ?? "",
        idp_expires_at: record.idpExpiresAt ?? 0,
        expires_at: record.expiresAt ?? 0,
        created_at: record.createdAt ?? 0,
    };
}
