import type { FastifyReply, FastifyRequest } from "fastify";

import { OrchidAuthContext, OrchidIdentityError } from "@orchid-ai/orchid/core";

import { appCtx } from "./context.js";

export async function resolveAuthContext(
    request: FastifyRequest,
    _reply: FastifyReply,
): Promise<void> {
    const { dev_auth_bypass, auth_domain } = await import("./settings.js").then((m) =>
        m.getSettings(),
    );

    const authorization = request.headers.authorization;

    // Dev bypass
    if (dev_auth_bypass) {
        const bypassCtx = new OrchidAuthContext({
            accessToken: "dev-token",
            tenantKey: "99999",
            userId: "dev-user-00000000",
        });
        request.authContext = bypassCtx;
        scheduleWarmForUser(bypassCtx);
        return;
    }

    if (!authorization || !authorization.startsWith("Bearer ")) {
        _reply.status(401).send({ detail: "Missing Bearer token" });
        return;
    }

    const token = authorization.slice(7);

    if (!appCtx.identityResolver) {
        _reply.status(503).send({ detail: "Identity resolver not configured" });
        return;
    }

    const xAuthDomain = request.headers["x-auth-domain"] as string | undefined;
    const domain = xAuthDomain || auth_domain;

    try {
        const authContext = await appCtx.identityResolver.resolve(domain, token);

        if (authContext.isExpired) {
            _reply.status(401).send({ detail: "Token is expired" });
            return;
        }

        request.authContext = authContext;
        scheduleWarmForUser(authContext);
    } catch (exc) {
        if (exc instanceof OrchidIdentityError) {
            const status = exc.statusCode === 401 || exc.statusCode === 403 ? exc.statusCode : 401;
            const detail = status === 403 ? "Forbidden" : "Authentication failed";
            _reply.status(status).send({ detail });
            return;
        }
        _reply.status(401).send({ detail: "Authentication failed" });
    }
}

function scheduleWarmForUser(auth: OrchidAuthContext): void {
    if (!appCtx.orchid) return;

    const orchid = appCtx.orchid as unknown as {
        sessionWarmer?: { isWarmed(auth_: OrchidAuthContext): boolean };
    };
    const warmer = orchid.sessionWarmer;
    if (!warmer || warmer.isWarmed(auth)) return;

    setImmediate(() => {
        safeWarmForUser(auth);
    });
}

async function safeWarmForUser(auth: OrchidAuthContext): Promise<void> {
    if (!appCtx.orchid) return;
    try {
        const orchid = appCtx.orchid as unknown as {
            sessionWarmer?: { warmForUser(auth_: OrchidAuthContext): Promise<void> };
        };
        const warmer = orchid.sessionWarmer;
        if (warmer) {
            await warmer.warmForUser(auth);
        }
    } catch {
        // Swallow — warm failures never abort requests
    }
}

export function getAuthContext(request: FastifyRequest): OrchidAuthContext {
    if (!request.authContext) {
        throw Object.assign(new Error("Auth context not resolved"), { statusCode: 401 });
    }
    return request.authContext;
}

export function getAuthContextOptional(request: FastifyRequest): OrchidAuthContext | null {
    return request.authContext ?? null;
}
