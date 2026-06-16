import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import type { FastifyPluginAsync } from "fastify";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getSettings } from "./settings.js";
import { setupOrchid, teardownOrchid } from "./lifecycle.js";
// Routers
import { router as chatsRouter } from "./routers/chats.js";
import { router as messagesRouter } from "./routers/messages.js";
import { router as streamingRouter } from "./routers/streaming.js";
import { router as resumeRouter } from "./routers/resume.js";
import { router as sessionRouter } from "./routers/session.js";
import { router as sharingRouter } from "./routers/sharing.js";
import { router as mcpAuthRouter } from "./routers/mcpAuth.js";
import { router as mcpGatewayRouter } from "./routers/mcpGateway.js";
import { router as mcpGatewayStateRouter } from "./routers/mcpGatewayState.js";
import { router as authInfoRouter } from "./routers/authInfo.js";
import { router as authExchangeRouter } from "./routers/authExchange.js";
import { router as authIdentityRouter } from "./routers/authIdentity.js";
import { router as diagnosticsRouter } from "./routers/diagnostics.js";
import { router as adminRouter } from "./routers/admin.js";
import { router as signalsRouter } from "./routers/signals.js";
import { router as jobsRouter } from "./routers/jobs.js";
import { router as runsRouter } from "./routers/runs.js";
import { router as schedulesRouter } from "./routers/schedules.js";
import { router as chatEventsRouter } from "./routers/chatEvents.js";
import { createConfigReloadHook } from "./middleware.js";
import { appCtx } from "./context.js";

export interface BuildAppOptions {
    settings?: ReturnType<typeof getSettings>;
}

const CONTENT_TYPES: Record<string, string> = {
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
};

export async function buildApp(opts?: BuildAppOptions): Promise<FastifyInstance> {
    const app = Fastify({
        logger: {
            level: "info",
            redact: {
                paths: ["req.headers.authorization", "headers.authorization"],
                censor: "Bearer ****",
            },
        },
    });

    const settings = opts?.settings || getSettings();

    // CORS
    const origins = settings.cors_allowed_origins
        .split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);

    await app.register(cors, {
        origin: origins,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["*"],
    });

    // Multipart (file uploads)
    await app.register(multipart, {
        limits: {
            fileSize: settings.upload_max_size_mb * 1024 * 1024,
        },
    });

    // Sensible (friendlier error helpers)
    await app.register(sensible);

    // Auth context decorator
    app.decorateRequest("authContext", undefined);

    if (settings.orchid_reload_interval > 0) {
        app.addHook(
            "onRequest",
            createConfigReloadHook(
                () => appCtx.orchid as { reloadConfig?: () => Promise<boolean> } | null,
                settings.orchid_reload_interval,
            ),
        );
    }

    // Lifecycle hooks
    app.addHook("onReady", async () => {
        await setupOrchid(settings);
    });

    app.addHook("onClose", async () => {
        await teardownOrchid();
    });

    await registerExportRoutes(app, process.env["ORCHID_EXPORT_DIR"] || "orchid_exports");

    // Register all routers
    await app.register(chatsRouter);
    await app.register(messagesRouter);
    await app.register(streamingRouter);
    await app.register(resumeRouter);
    await app.register(sessionRouter);
    await app.register(sharingRouter);
    await app.register(mcpAuthRouter);
    await app.register(mcpGatewayRouter);
    await app.register(mcpGatewayStateRouter);
    await app.register(authInfoRouter);
    await app.register(authExchangeRouter);
    await app.register(authIdentityRouter);
    await app.register(diagnosticsRouter);
    await app.register(adminRouter);
    await app.register(signalsRouter);
    await app.register(jobsRouter);
    await app.register(runsRouter);
    await app.register(schedulesRouter);
    await app.register(chatEventsRouter);
    await loadRouterPlugins(app);

    return app;
}

export async function registerExportRoutes(app: FastifyInstance, exportDir: string): Promise<void> {
    const root = resolve(exportDir);
    try {
        mkdirSync(root, { recursive: true });
    } catch (error) {
        app.log.warn({ error }, "could not create export directory");
        return;
    }

    app.get("/exports/*", async (request, reply) => {
        const rawPath = (request.params as { "*": string })["*"] || "";
        const safeRelative = normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
        const absolute = resolve(join(root, safeRelative));

        if (!absolute.startsWith(root) || !existsSync(absolute)) {
            return reply.status(404).send({ detail: "Export not found" });
        }

        const contentType =
            CONTENT_TYPES[extname(absolute).toLowerCase()] || "application/octet-stream";
        reply.header("Content-Type", contentType);
        return reply.send(createReadStream(absolute));
    });
}

export async function loadRouterPlugins(
    app: FastifyInstance,
    packageRoots?: string[],
): Promise<void> {
    const roots = packageRoots ?? [join(process.cwd(), "node_modules")];
    for (const root of roots) {
        const packageDirs = await discoverPackageDirs(root);
        for (const dir of packageDirs) {
            await tryRegisterRouterPackage(app, dir);
        }
    }
}

async function discoverPackageDirs(root: string): Promise<string[]> {
    if (!existsSync(root)) return [];

    try {
        const entries = await readdir(root, { withFileTypes: true });
        const dirs: string[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith("@")) {
                const scoped = await readdir(join(root, entry.name), { withFileTypes: true });
                for (const child of scoped) {
                    if (child.isDirectory()) {
                        dirs.push(join(root, entry.name, child.name));
                    }
                }
            } else {
                dirs.push(join(root, entry.name));
            }
        }
        return dirs;
    } catch {
        return [];
    }
}

async function tryRegisterRouterPackage(app: FastifyInstance, packageDir: string): Promise<void> {
    const packageJsonPath = join(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) return;

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
            name?: string;
            orchid?: { apiRouters?: string[] | string | Record<string, string> };
            orchid_api?: { routers?: string[] | string | Record<string, string> };
        };

        const refs = normalisePluginRefs(pkg.orchid?.apiRouters ?? pkg.orchid_api?.routers);
        for (const ref of refs) {
            const pluginPath = ref.startsWith(".") ? join(packageDir, ref) : ref;
            const mod = await import(pathToFileURL(pluginPath).href);
            const plugin = (mod.router ?? mod.default) as FastifyPluginAsync | undefined;
            if (typeof plugin === "function") {
                await app.register(plugin);
            }
        }
    } catch (error) {
        app.log.warn({ error, packageDir }, "router plugin discovery failed");
    }
}

function normalisePluginRefs(
    value: string[] | string | Record<string, string> | undefined,
): string[] {
    if (!value) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value;
    return Object.values(value);
}
