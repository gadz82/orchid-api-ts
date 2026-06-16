import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Settings", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        vi.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.resetModules();
    });

    it("returns default settings when no env vars set", async () => {
        delete process.env["LITELLM_MODEL"];
        delete process.env["VECTOR_BACKEND"];

        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.litellm_model).toBe("ollama/llama3.2");
        expect(s.vector_backend).toBe("qdrant");
        expect(s.embedding_model).toBe("text-embedding-3-small");
        expect(s.upload_max_size_mb).toBe(20);
        expect(s.chunk_size).toBe(1000);
        expect(s.chunk_overlap).toBe(200);
        expect(s.stream_max_seconds).toBe(300);
    });

    it("reads from env vars", async () => {
        process.env["LITELLM_MODEL"] = "openai/gpt-4o";
        process.env["VECTOR_BACKEND"] = "chroma";
        process.env["UPLOAD_MAX_SIZE_MB"] = "50";

        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.litellm_model).toBe("openai/gpt-4o");
        expect(s.vector_backend).toBe("chroma");
        expect(s.upload_max_size_mb).toBe(50);
    });

    it("handles boolean-like env vars", async () => {
        process.env["DEV_AUTH_BYPASS"] = "true";
        process.env["LANGSMITH_TRACING"] = "1";

        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.dev_auth_bypass).toBe(true);
        expect(s.langsmith_tracing).toBe(true);
    });

    it("has rate limit defaults", async () => {
        delete process.env["RATE_LIMIT_MESSAGES_PER_MINUTE"];
        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.rate_limit_messages_per_minute).toBe(30);
        expect(s.rate_limit_uploads_per_minute).toBe(10);
        expect(s.rate_limit_index_per_minute).toBe(5);
    });

    it("has MCP storage defaults", async () => {
        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.mcp_token_store_class).toBe("sqlite");
        expect(s.mcp_gateway_state_service_token).toBe("");
    });

    it("has auth defaults", async () => {
        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.identity_resolver_class).toBe("");
        expect(s.auth_domain).toBe("");
    });

    it("has CORS defaults", async () => {
        const { getSettings, resetSettings } = await import("../src/settings.js");
        resetSettings();

        const s = getSettings();
        expect(s.cors_allowed_origins).toContain("localhost:3000");
    });
});
