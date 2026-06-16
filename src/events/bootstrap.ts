import { HTTPIngestionProducer } from "./producers/http.js";

export interface EventsRuntime {
    enabled: boolean;
    signalStore?: unknown;
    jobStore?: unknown;
    scheduleStore?: unknown;
    triggerRegistry?: unknown;
    signalQueue?: unknown;
    eventStream?: unknown;
    producers?: unknown[];
    httpProducer?: unknown;
}

export async function startEvents(config: unknown): Promise<EventsRuntime> {
    const cfg = config as { events?: { enabled?: boolean } } | null;
    if (!cfg?.events?.enabled) {
        return { enabled: false };
    }

    const httpProducer = new HTTPIngestionProducer(null);

    return {
        enabled: true,
        producers: [],
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
