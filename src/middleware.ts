import type { FastifyRequest, FastifyReply } from "fastify";

interface ReloadableOrchid {
    reloadConfig?: () => Promise<boolean> | boolean;
}

export function createConfigReloadHook(
    getOrchid: () => ReloadableOrchid | null,
    intervalSeconds: number,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
    let lastCheck = 0;

    return async function configReloadHook(
        _request: FastifyRequest,
        _reply: FastifyReply,
    ): Promise<void> {
        if (intervalSeconds <= 0) return;

        const orchid = getOrchid();
        if (!orchid?.reloadConfig) return;

        const now = Date.now();
        if (now - lastCheck < intervalSeconds * 1000) return;
        lastCheck = now;

        try {
            await orchid.reloadConfig();
        } catch {
            // Reload failures are non-fatal; the app keeps serving the previous config.
        }
    };
}
