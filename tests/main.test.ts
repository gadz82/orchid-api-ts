import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("main helpers", () => {
    it("registerExportRoutes serves files from the export directory", async () => {
        const tmpRoot = mkdtempSync(join(tmpdir(), "orchid-api-exports-"));
        const exportDir = join(tmpRoot, "exports");
        mkdirSync(exportDir, { recursive: true });
        writeFileSync(join(exportDir, "hello.txt"), "hello world", "utf-8");

        const { registerExportRoutes } = await import("../src/main.js");
        const app = Fastify();
        await registerExportRoutes(app, exportDir);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/exports/hello.txt" });
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe("hello world");
        expect(res.headers["content-type"]).toContain("text/plain");

        await app.close();
        rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("loadRouterPlugins registers plugin routers from package metadata", async () => {
        const tmpRoot = mkdtempSync(join(tmpdir(), "orchid-api-plugins-"));
        const packageDir = join(tmpRoot, "plugin-package");
        mkdirSync(packageDir, { recursive: true });

        writeFileSync(
            join(packageDir, "package.json"),
            JSON.stringify(
                {
                    name: "plugin-package",
                    type: "module",
                    orchid: {
                        apiRouters: ["./plugin.mjs"],
                    },
                },
                null,
                2,
            ),
            "utf-8",
        );
        writeFileSync(
            join(packageDir, "plugin.mjs"),
            [
                "export default async function pluginRouter(app) {",
                "  app.get('/plugin-health', async () => ({ status: 'ok' }));",
                "}",
            ].join("\n"),
            "utf-8",
        );

        const { loadRouterPlugins } = await import("../src/main.js");
        const app = Fastify();
        await loadRouterPlugins(app, [tmpRoot]);
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/plugin-health" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: "ok" });

        await app.close();
        rmSync(tmpRoot, { recursive: true, force: true });
    });
});
