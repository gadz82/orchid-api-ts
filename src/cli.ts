#!/usr/bin/env node
import { getSettings } from "./settings.js";
import { buildApp } from "./main.js";

async function main(): Promise<void> {
    const settings = getSettings();
    const port = parseInt(process.env["PORT"] || "8000", 10);
    const host = process.env["HOST"] || "0.0.0.0";

    const app = await buildApp({ settings });

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
    for (const signal of signals) {
        process.on(signal, async () => {
            await app.close();
            process.exit(0);
        });
    }

    try {
        await app.listen({ port, host });
        app.log.info(`Orchid API listening on http://${host}:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

main();
