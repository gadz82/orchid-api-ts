import type { FastifyReply } from "fastify";

/**
 * Copy CORS headers from the Fastify reply onto `reply.raw` so they survive a
 * subsequent `reply.raw.writeHead()` call (used by SSE endpoints that bypass
 * Fastify's response pipeline).
 *
 * `@fastify/cors` sets `Access-Control-Allow-*` headers via `reply.header()`,
 * which only lands on the Fastify reply object. When the handler takes over
 * the raw Node response with `reply.raw.writeHead()`, those headers are not
 * included and the browser blocks the cross-origin response.
 */
export function applyCorsHeaders(reply: FastifyReply): void {
    const headers = reply.getHeaders();
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase().startsWith("access-control-")) {
            reply.raw.setHeader(name, value as string | string[]);
        }
    }
}
