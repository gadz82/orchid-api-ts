import { createHash, randomBytes } from "node:crypto";

import { OrchidMCPAuthDiscovery } from "@orchid-ai/orchid/mcp";
import { OrchidMCPClientRegistration, OrchidMCPTokenRecord } from "@orchid-ai/orchid/core";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { getAuthContext, resolveAuthContext } from "../auth.js";
import {
    getMCPClientRegistrationStore,
    getMCPClientRegistrationStoreOptional,
    getMCPTokenStore,
    getMCPTokenStoreOptional,
    getOAuthStateStore,
    getOrchid,
} from "../context.js";
import { getSettings } from "../settings.js";

async function mcpAuthRouter(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", async (request, reply) => {
        if (request.raw.url?.startsWith("/mcp/auth/callback")) {
            return;
        }
        await resolveAuthContext(request, reply);
    });

    fastify.get("/mcp/auth/servers", async (request, reply) => {
        const auth = getAuthContext(request);
        const tokenStore = getMCPTokenStoreOptional();
        const registrationStore = getMCPClientRegistrationStoreOptional();
        const orchid = getOrchid();
        const registry = (
            orchid.runtime as {
                mcpAuthRegistry?: {
                    empty?: boolean;
                    oauthServers?: Map<string, { agentNames: string[] }>;
                };
            }
        ).mcpAuthRegistry;

        if (!registry?.oauthServers || registry.oauthServers.size === 0) {
            return reply.send([]);
        }

        const rows = [];
        for (const [name, info] of registry.oauthServers.entries()) {
            const token = tokenStore
                ? await tokenStore.getToken(auth.tenantKey, auth.userId, name)
                : null;
            const registration = registrationStore ? await registrationStore.get(name) : null;
            rows.push({
                server_name: name,
                agent_names: [...(info.agentNames ?? [])],
                authorized: !!token && !token.isExpired,
                token_expired: !!token && token.isExpired,
                discovered: registration !== null,
                scopes: registration?.scopesSupported ?? "",
            });
        }
        return reply.send(rows);
    });

    fastify.post<{ Params: { name: string } }>(
        "/mcp/auth/servers/:name/discover",
        async (request, reply) => {
            getAuthContext(request);
            const params = request.params as { name: string };
            const body = (request.body ?? {}) as { resource_metadata_url?: string };
            const orchid = getOrchid();
            const registry = (
                orchid.runtime as {
                    mcpAuthRegistry?: {
                        getServer(name: string): { url: string } | null;
                        requiresOAuth?(name: string): boolean;
                    };
                }
            ).mcpAuthRegistry;

            if (!registry || (registry.requiresOAuth && !registry.requiresOAuth(params.name))) {
                return reply.status(404).send({
                    detail: `MCP server '${params.name}' is not registered as OAuth-requiring`,
                });
            }

            const server = registry.getServer(params.name);
            if (!server) {
                return reply.status(404).send({ detail: `MCP server '${params.name}' not found` });
            }

            const discovered = body.resource_metadata_url
                ? await OrchidMCPAuthDiscovery.fetchWellKnown(body.resource_metadata_url)
                : await OrchidMCPAuthDiscovery.discoverOAuthEndpoints(server.url);
            if (!discovered) {
                return reply.status(502).send({ detail: "OAuth discovery failed" });
            }

            const store = getMCPClientRegistrationStore();
            const registration = new OrchidMCPClientRegistration({
                serverName: params.name,
                authorizationEndpoint: String(discovered["authorization_endpoint"] ?? ""),
                tokenEndpoint: String(discovered["token_endpoint"] ?? ""),
                registrationEndpoint: String(discovered["registration_endpoint"] ?? ""),
                issuer: String(discovered["issuer"] ?? ""),
                scopesSupported: joinScopes(discovered["scopes_supported"]),
                tokenEndpointAuthMethodsSupported: joinScopes(
                    discovered["token_endpoint_auth_methods_supported"],
                    "client_secret_post",
                ),
            });

            if (registration.registrationEndpoint) {
                try {
                    const dcr = await OrchidMCPAuthDiscovery.registerClient({
                        registrationEndpoint: registration.registrationEndpoint,
                        clientName: "orchid-api-ts",
                        redirectUris: [callbackUrl()],
                    });
                    registration.clientId = String(dcr["client_id"] ?? "");
                    registration.clientSecret = String(dcr["client_secret"] ?? "");
                    registration.clientIdIssuedAt = Number(dcr["client_id_issued_at"] ?? 0);
                    registration.clientSecretExpiresAt = Number(
                        dcr["client_secret_expires_at"] ?? 0,
                    );
                } catch (error) {
                    return reply.status(502).send({
                        detail:
                            error instanceof Error
                                ? error.message
                                : "Dynamic client registration failed",
                    });
                }
            }

            await store.save(registration);
            return reply.send({
                server_name: registration.serverName,
                discovered: true,
                authorization_endpoint: registration.authorizationEndpoint,
                token_endpoint: registration.tokenEndpoint,
                issuer: registration.issuer,
                scopes_supported: registration.scopesSupported,
            });
        },
    );

    fastify.get<{ Params: { name: string } }>(
        "/mcp/auth/servers/:name/authorize",
        async (request, reply) => {
            const auth = getAuthContext(request);
            const params = request.params as { name: string };
            const orchid = getOrchid();
            const registry = (
                orchid.runtime as {
                    mcpAuthRegistry?: { getServer(name: string): { url: string } | null };
                }
            ).mcpAuthRegistry;
            const server = registry?.getServer(params.name);
            if (!server) {
                return reply.status(404).send({
                    detail: `MCP server '${params.name}' not found or does not require OAuth`,
                });
            }

            const tokenStore = getMCPTokenStoreOptional();
            const existing = tokenStore
                ? await tokenStore.getToken(auth.tenantKey, auth.userId, params.name)
                : null;
            if (existing && !existing.isExpired) {
                return reply.send({ status: "already_authorized", server: params.name });
            }

            const registrationStore = getMCPClientRegistrationStore();
            let registration = await registrationStore.get(params.name);
            if (!registration) {
                const discovered = await OrchidMCPAuthDiscovery.discoverOAuthEndpoints(server.url);
                if (!discovered) {
                    return reply.status(502).send({ detail: "OAuth discovery failed" });
                }
                registration = new OrchidMCPClientRegistration({
                    serverName: params.name,
                    authorizationEndpoint: String(discovered["authorization_endpoint"] ?? ""),
                    tokenEndpoint: String(discovered["token_endpoint"] ?? ""),
                    registrationEndpoint: String(discovered["registration_endpoint"] ?? ""),
                    issuer: String(discovered["issuer"] ?? ""),
                    scopesSupported: joinScopes(discovered["scopes_supported"]),
                    tokenEndpointAuthMethodsSupported: joinScopes(
                        discovered["token_endpoint_auth_methods_supported"],
                        "client_secret_post",
                    ),
                });
                if (registration.registrationEndpoint) {
                    const dcr = await OrchidMCPAuthDiscovery.registerClient({
                        registrationEndpoint: registration.registrationEndpoint,
                        clientName: "orchid-api-ts",
                        redirectUris: [callbackUrl()],
                    });
                    registration.clientId = String(dcr["client_id"] ?? "");
                    registration.clientSecret = String(dcr["client_secret"] ?? "");
                    registration.clientIdIssuedAt = Number(dcr["client_id_issued_at"] ?? 0);
                    registration.clientSecretExpiresAt = Number(
                        dcr["client_secret_expires_at"] ?? 0,
                    );
                }
                await registrationStore.save(registration);
            }

            if (!registration.authorizationEndpoint) {
                return reply
                    .status(500)
                    .send({ detail: "Stored registration lacks authorization endpoint" });
            }

            const stateStore = getOAuthStateStore();
            const state = randomBytes(24).toString("base64url");
            const codeVerifier = randomBytes(48).toString("base64url");
            const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

            await stateStore.setState(state, {
                serverName: params.name,
                tenantKey: auth.tenantKey,
                userId: auth.userId,
                codeVerifier,
                tokenEndpoint: registration.tokenEndpoint,
            });

            const authUrl = new URL(registration.authorizationEndpoint);
            authUrl.searchParams.set("response_type", "code");
            authUrl.searchParams.set("client_id", registration.clientId);
            authUrl.searchParams.set("redirect_uri", callbackUrl());
            authUrl.searchParams.set("scope", registration.scopesSupported || "openid");
            authUrl.searchParams.set("state", state);
            authUrl.searchParams.set("code_challenge", codeChallenge);
            authUrl.searchParams.set("code_challenge_method", "S256");

            return reply.send({ authorize_url: authUrl.toString(), state });
        },
    );

    fastify.get("/mcp/auth/callback", async (request, reply) => {
        const query = request.query as { code?: string; state?: string; error?: string };
        if (query.error) {
            reply.type("text/html");
            return reply.status(400).send(renderMessagePage("Authorization failed", query.error));
        }
        if (!query.code || !query.state) {
            reply.type("text/html");
            return reply.status(400).send(renderMessagePage("Missing code or state"));
        }

        const stateStore = getOAuthStateStore();
        const pending = await stateStore.getState(query.state);
        if (!pending) {
            reply.type("text/html");
            return reply.status(400).send(renderMessagePage("Invalid or expired state"));
        }
        await stateStore.deleteState(query.state);

        const serverName = String(pending["serverName"] ?? "");
        const tenantKey = String(pending["tenantKey"] ?? "");
        const userId = String(pending["userId"] ?? "");
        const codeVerifier = String(pending["codeVerifier"] ?? "");
        const registrationStore = getMCPClientRegistrationStore();
        const registration = await registrationStore.get(serverName);
        if (!registration) {
            reply.type("text/html");
            return reply.status(500).send(renderMessagePage(`Unknown server: ${serverName}`));
        }

        const tokenEndpoint = String(pending["tokenEndpoint"] ?? registration.tokenEndpoint ?? "");
        if (!tokenEndpoint) {
            reply.type("text/html");
            return reply.status(500).send(renderMessagePage("No token endpoint available"));
        }

        const tokenResponse = await exchangeAuthorizationCode({
            tokenEndpoint,
            code: query.code,
            codeVerifier,
            redirectUri: callbackUrl(),
            registration,
        });
        if ("error" in tokenResponse) {
            reply.type("text/html");
            return reply
                .status(tokenResponse.statusCode)
                .send(renderMessagePage("Token exchange failed", tokenResponse.error));
        }

        const now = Math.floor(Date.now() / 1000);
        const tokenStore = getMCPTokenStoreOptional();
        if (tokenStore) {
            await tokenStore.saveToken(
                new OrchidMCPTokenRecord({
                    serverName,
                    tenantId: tenantKey,
                    userId,
                    accessToken: tokenResponse.accessToken,
                    refreshToken: tokenResponse.refreshToken ?? "",
                    expiresAt: now + (tokenResponse.expiresIn ?? 3600),
                    scopes: registration.scopesSupported,
                }),
            );
        }

        reply.type("text/html");
        return reply.send(renderSuccessPage(serverName));
    });

    fastify.delete<{ Params: { name: string } }>(
        "/mcp/auth/servers/:name/token",
        async (request, reply) => {
            const auth = getAuthContext(request);
            const params = request.params as { name: string };
            const tokenStore = getMCPTokenStore();

            const deleted = await tokenStore.deleteToken(auth.tenantKey, auth.userId, params.name);
            if (!deleted) {
                return reply.status(404).send({ detail: "No token found for this server" });
            }

            return reply.status(204).send();
        },
    );
}

export const router = fp(mcpAuthRouter, { name: "mcpAuth" });

function callbackUrl(): string {
    const settings = getSettings();
    return `${settings.api_base_url.replace(/\/$/, "")}/mcp/auth/callback`;
}

function joinScopes(value: unknown, fallback = ""): string {
    if (Array.isArray(value)) {
        return value.map(String).join(" ");
    }
    if (typeof value === "string") return value;
    return fallback;
}

function renderMessagePage(heading: string, detail = ""): string {
    const safeHeading = escapeHtml(heading);
    const safeDetail = escapeHtml(detail);
    return `<html><body><h2>${safeHeading}</h2>${safeDetail ? `<p>${safeDetail}</p>` : ""}<script>window.close();</script></body></html>`;
}

function renderSuccessPage(serverName: string): string {
    const payload = JSON.stringify({ type: "mcp-auth-complete", server: serverName }).replace(
        /<\//g,
        "<\\/",
    );
    return `<html><body><h2>Authorization successful</h2><p>You can close this window.</p><script>window.opener?.postMessage(${payload}, "*");setTimeout(function(){window.close();},1000);</script></body></html>`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

async function exchangeAuthorizationCode(options: {
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    registration: OrchidMCPClientRegistration;
}): Promise<
    | { accessToken: string; refreshToken?: string; expiresIn?: number }
    | { error: string; statusCode: number }
> {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: options.code,
        redirect_uri: options.redirectUri,
        client_id: options.registration.clientId,
        code_verifier: options.codeVerifier,
    });

    const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
    };
    if (options.registration.clientSecret && !options.registration.usesBasicAuth) {
        body.set("client_secret", options.registration.clientSecret);
    }
    if (options.registration.clientSecret && options.registration.usesBasicAuth) {
        headers["Authorization"] = `Basic ${Buffer.from(
            `${options.registration.clientId}:${options.registration.clientSecret}`,
        ).toString("base64")}`;
    }

    try {
        const response = await fetch(options.tokenEndpoint, {
            method: "POST",
            headers,
            body,
        });
        if (!response.ok) {
            return {
                error: await response.text(),
                statusCode: response.status,
            };
        }
        const data = (await response.json()) as Record<string, unknown>;
        return {
            accessToken: String(data["access_token"] ?? ""),
            refreshToken:
                typeof data["refresh_token"] === "string" ? data["refresh_token"] : undefined,
            expiresIn: typeof data["expires_in"] === "number" ? data["expires_in"] : undefined,
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Token exchange failed",
            statusCode: 500,
        };
    }
}
