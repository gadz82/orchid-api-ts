import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SettingsSchema = z.object({
    // Auth
    identity_resolver_class: z.string().default(""),
    auth_domain: z.string().default(""),
    auth_config_provider_class: z.string().default(""),
    auth_exchange_client_class: z.string().default(""),
    auth_oauth_client_id_env: z.string().default(""),
    auth_oauth_scope: z.string().default(""),

    // LLM
    litellm_model: z.string().default("ollama/llama3.2"),

    // Agent config
    agents_config_path: z.string().default("agents.yaml"),
    orchid_config_format: z.enum(["auto", "md", "yaml"]).default("auto"),
    orchid_reload_interval: z.coerce.number().int().default(30),

    // Vector DB
    qdrant_url: z.string().default("http://qdrant:6333"),
    vector_backend: z.string().default("qdrant"),

    // Embeddings
    embedding_model: z.string().default("text-embedding-3-small"),

    // Chat persistence
    chat_storage_class: z.string().default("sqlite"),
    chat_db_dsn: z.string().default("~/.orchid/chats.db"),
    chat_extra_migrations_package: z.string().default(""),

    // Document upload
    vision_model: z.string().default(""),
    upload_namespace: z.string().default("uploads"),
    upload_max_size_mb: z.coerce.number().int().default(20),
    chunk_size: z.coerce.number().int().default(1000),
    chunk_overlap: z.coerce.number().int().default(200),

    // Content sources
    content_sources_json: z.string().default(""),

    // Streaming
    stream_max_seconds: z.coerce.number().int().default(300),

    // Rate limiting
    rate_limit_messages_per_minute: z.coerce.number().int().default(30),
    rate_limit_uploads_per_minute: z.coerce.number().int().default(10),
    rate_limit_index_per_minute: z.coerce.number().int().default(5),

    // Dev mode
    dev_auth_bypass: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .pipe(z.boolean())
        .default("false"),

    // Startup hook
    startup_hook: z.string().default(""),

    // Admin endpoints
    allow_index_endpoint: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .pipe(z.boolean())
        .default("false"),

    // MCP OAuth token storage
    mcp_token_store_class: z.string().default("sqlite"),
    mcp_token_store_dsn: z.string().default("~/.orchid/chats.db"),

    // MCP client-registration store (RFC 7591 DCR)
    mcp_client_registration_store_class: z.string().default("sqlite"),
    mcp_client_registration_store_dsn: z.string().default("~/.orchid/chats.db"),

    // MCP gateway-state store (INBOUND MCP OAuth)
    mcp_gateway_state_store_class: z.string().default("sqlite"),
    mcp_gateway_state_store_dsn: z.string().default("~/.orchid/chats.db"),
    mcp_gateway_state_service_token: z.string().default(""),

    // MCP OAuth state store (PKCE + CSRF state)
    oauth_state_store_class: z.string().default("memory"),
    oauth_state_store_dsn: z.string().default(""),
    oauth_state_ttl_seconds: z.coerce.number().int().default(600),

    // Checkpointer
    checkpointer_type: z.string().default(""),
    checkpointer_dsn: z.string().default(""),

    // API base URL
    api_base_url: z.string().default("http://localhost:8000"),

    // CORS
    cors_allowed_origins: z.string().default("http://localhost:3000,http://frontend:3000"),

    // Tracing
    langsmith_api_key: z.string().default(""),
    langsmith_tracing: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .pipe(z.boolean())
        .default("false"),
    langsmith_project: z.string().default("agents"),
});

export type Settings = z.infer<typeof SettingsSchema>;

function applyYamlToEnv(configPath: string): void {
    if (!configPath || configPath.endsWith(".md")) return;
    if (!existsSync(configPath)) return;

    try {
        const raw = readFileSync(configPath, "utf-8");
        const data = parseYaml(raw) as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return;

        const skipSections = new Set(["api"]);
        for (const [sectionKey, sectionValue] of Object.entries(data)) {
            if (skipSections.has(sectionKey)) continue;
            if (sectionValue && typeof sectionValue === "object" && !Array.isArray(sectionValue)) {
                for (const [key, value] of Object.entries(
                    sectionValue as Record<string, unknown>,
                )) {
                    const envVar = YAML_TO_ENV[key];
                    if (envVar && !(envVar in process.env)) {
                        process.env[envVar] = String(value);
                    }
                }
            }
        }
    } catch {
        // YAML parse failures are non-fatal at import time
    }
}

function applyApiYamlConfig(configPath: string): void {
    if (!configPath || configPath.endsWith(".md")) return;
    if (!existsSync(configPath)) return;

    try {
        const raw = readFileSync(configPath, "utf-8");
        const data = parseYaml(raw) as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return;

        const apiSection = data["api"];
        if (!apiSection || typeof apiSection !== "object" || Array.isArray(apiSection)) return;

        const API_YAML_TO_ENV: Record<string, string> = {
            base_url: "API_BASE_URL",
            cors_allowed_origins: "CORS_ALLOWED_ORIGINS",
            allow_index_endpoint: "ALLOW_INDEX_ENDPOINT",
        };

        for (const [key, value] of Object.entries(apiSection)) {
            const envVar = API_YAML_TO_ENV[key];
            if (envVar && !(envVar in process.env)) {
                process.env[envVar] = String(value);
            }
        }
    } catch {
        // Non-fatal
    }
}

const YAML_TO_ENV: Record<string, string> = {};

// Apply YAML config at module import time (before any Settings instantiation)
(function applyYamlConfig() {
    const configPath = process.env["ORCHID_CONFIG"] || "";
    if (!configPath) return;

    applyYamlToEnv(configPath);
    applyApiYamlConfig(configPath);
})();

function resolveEnvToSettings(raw: Record<string, string | undefined>): Settings {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value !== undefined) {
            env[key.toLowerCase()] = value;
        }
    }
    const parsed = SettingsSchema.safeParse(env);
    if (!parsed.success) {
        throw new Error(
            `Settings validation failed: ${parsed.error.errors.map((e) => e.message).join("; ")}`,
        );
    }
    return parsed.data;
}

let _cachedSettings: Settings | null = null;

export function getSettings(): Settings {
    if (_cachedSettings) return _cachedSettings;
    _cachedSettings = resolveEnvToSettings(process.env as Record<string, string | undefined>);
    return _cachedSettings;
}

export function resetSettings(): void {
    _cachedSettings = null;
}

export default SettingsSchema;
