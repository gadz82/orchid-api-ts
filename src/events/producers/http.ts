import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export class HTTPIngestionProducer {
    private dispatcher: unknown = null;

    constructor(private readonly registry: unknown) {}

    get router(): FastifyPluginAsync {
        return fp(
            async (fastify) => {
                fastify.post("/signals", async (request, reply) => {
                    const body = (request.body ?? {}) as Record<string, unknown>;
                    const ingest = resolveIngestHandler(this.dispatcher, this.registry);
                    if (!ingest) {
                        return reply
                            .status(503)
                            .send({ detail: "signal ingestion is not configured" });
                    }

                    const result = await ingest(body);
                    return reply.send(result ?? { status: "accepted" });
                });
            },
            { name: "httpIngestionProducer" },
        );
    }

    async start(dispatcher: unknown): Promise<void> {
        this.dispatcher = dispatcher;
    }
}

function resolveIngestHandler(
    dispatcher: unknown,
    registry: unknown,
): ((payload: Record<string, unknown>) => Promise<unknown>) | null {
    const dispatcherObj = dispatcher as {
        ingest?(payload: Record<string, unknown>): Promise<unknown>;
        dispatch?(payload: Record<string, unknown>): Promise<unknown>;
    } | null;
    if (dispatcherObj?.ingest) {
        return dispatcherObj.ingest.bind(dispatcherObj);
    }
    if (dispatcherObj?.dispatch) {
        return dispatcherObj.dispatch.bind(dispatcherObj);
    }

    const registryObj = registry as {
        emit?(payload: Record<string, unknown>): Promise<unknown>;
        ingest?(payload: Record<string, unknown>): Promise<unknown>;
    } | null;
    if (registryObj?.ingest) {
        return registryObj.ingest.bind(registryObj);
    }
    if (registryObj?.emit) {
        return registryObj.emit.bind(registryObj);
    }

    return null;
}
