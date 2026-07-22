import { HTTPIngestionProducer } from "./producers/http.js";
import {
    InMemorySignalStore,
    InMemoryJobStore,
    InMemorySignalQueue,
} from "@orchid-ai/orchid/events";
import { OrchidSignalEmitter, DefaultSignalDispatcher } from "@orchid-ai/orchid/core";
import type { OrchidEventProducer } from "@orchid-ai/orchid/core";

export interface EventsRuntime {
    enabled: boolean;
    signalStore?: InMemorySignalStore;
    jobStore?: InMemoryJobStore;
    scheduleStore?: unknown;
    triggerRegistry?: unknown;
    signalQueue?: InMemorySignalQueue;
    eventStream?: unknown;
    producers?: OrchidEventProducer[];
    httpProducer?: HTTPIngestionProducer;
    dispatcher?: DefaultSignalDispatcher;
    emitter?: OrchidSignalEmitter;
}

async function importClass(classPath: string, configDir?: string): Promise<unknown> {
    const parts = classPath.split("#");
    const modulePath = parts[0]!;
    const exportName = parts.length > 1 ? parts[1]! : "default";

    if (modulePath.startsWith(".")) {
        const { pathToFileURL } = await import("node:url");
        const { resolve } = await import("node:path");
        const baseDir = configDir && resolve(configDir) !== resolve(process.cwd()) ? configDir : process.cwd();
        const resolved = resolve(baseDir, modulePath);
        const mod = await import(pathToFileURL(resolved).href);
        return mod[exportName] ?? mod;
    }

    const mod = await import(modulePath);
    return mod[exportName] ?? mod;
}

class DispatcherSignalEmitter extends OrchidSignalEmitter {
    private _dispatcher: DefaultSignalDispatcher;

    constructor(dispatcher: DefaultSignalDispatcher) {
        super();
        this._dispatcher = dispatcher;
    }

    async emit(envelope: Parameters<DefaultSignalDispatcher["ingest"]>[0]) {
        return this._dispatcher.ingest(envelope);
    }
}

export async function startEvents(
    config: unknown,
    configDir?: string,
): Promise<EventsRuntime> {
    const cfg = config as {
        events?: {
            enabled?: boolean;
            producers?: Array<{ class: string; extraArgs?: Record<string, unknown> }>;
        };
    } | null;

    if (!cfg?.events?.enabled) {
        return { enabled: false };
    }

    const signalStore = new InMemorySignalStore();
    const jobStore = new InMemoryJobStore();
    const queue = new InMemorySignalQueue();
    const dispatcher = new DefaultSignalDispatcher({ store: signalStore, queue });
    const emitter = new DispatcherSignalEmitter(dispatcher);

    const httpProducer = new HTTPIngestionProducer(null);

    const producers: OrchidEventProducer[] = [];
    for (const ref of cfg.events.producers ?? []) {
        if (ref.class.endsWith("HTTPIngestionProducer")) {
            continue;
        }

        const cls = (await importClass(ref.class, configDir)) as new (
            opts: Record<string, unknown>,
        ) => OrchidEventProducer;
        const instance = new cls({ ...ref.extraArgs, emitter });
        await instance.start();
        producers.push(instance);
    }

    return {
        enabled: true,
        signalStore,
        jobStore,
        signalQueue: queue,
        dispatcher,
        emitter,
        producers,
        httpProducer,
    };
}

export async function stopEvents(events: unknown): Promise<void> {
    const runtime = events as {
        producers?: Array<{ stop?(): Promise<void>; close?(): Promise<void> }>;
    } | null;
    for (const producer of runtime?.producers ?? []) {
        if (producer.stop) {
            await producer.stop();
            continue;
        }
        if (producer.close) {
            await producer.close();
        }
    }
}
