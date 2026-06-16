import type { FastifyReply, FastifyRequest } from "fastify";

interface TokenBucket {
    tokens: number;
    lastRefill: number;
    maxTokens: number;
    refillRate: number; // tokens per millisecond
}

const buckets = new Map<string, TokenBucket>();

function getKey(request: FastifyRequest): string {
    const tenant = request.authContext?.tenantKey ?? "anon";
    const user = request.authContext?.userId ?? "anon";
    return `${tenant}:${user}`;
}

function getBucket(key: string, maxTokens: number, periodMs: number): TokenBucket {
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = {
            tokens: maxTokens,
            lastRefill: Date.now(),
            maxTokens,
            refillRate: maxTokens / periodMs,
        };
        buckets.set(key, bucket);
    }
    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
    return bucket;
}

export function createRateLimit(name: string, calls: number, period: number) {
    const periodMs = period * 1000;

    return async function rateLimitPreHandler(
        request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<void> {
        if (calls <= 0) return; // Disabled

        const key = `${name}:${getKey(request)}`;
        const bucket = getBucket(key, calls, periodMs);

        if (bucket.tokens < 1) {
            reply.status(429).send({
                detail: `Rate limit exceeded for ${name}. Try again later.`,
            });
            return;
        }

        bucket.tokens -= 1;
    };
}

// Cleanup stale buckets periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
        if (now - bucket.lastRefill > 5 * 60 * 1000) {
            buckets.delete(key);
        }
    }
}, 60 * 1000).unref();
