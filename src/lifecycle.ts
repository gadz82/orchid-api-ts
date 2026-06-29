import type { Orchid, OrchidFactoryOverrides } from "@orchid-ai/orchid";
import { runStartupHooks } from "@orchid-ai/orchid";
import type { OrchidOAuthStateStore } from "@orchid-ai/orchid/mcp";
import type { OrchidChatStorage } from "@orchid-ai/orchid/persistence";
import type {
    OrchidMCPTokenStore,
    OrchidMCPClientRegistrationStoreABC,
} from "@orchid-ai/orchid/core";
import type {
    OrchidMCPGatewayClientStoreABC,
    OrchidMCPGatewayAuthCodeStoreABC,
    OrchidMCPGatewayTokenStoreABC,
} from "@orchid-ai/orchid/core";

import { appCtx } from "./context.js";
import type { Settings } from "./settings.js";
import { getSettings } from "./settings.js";
import { configureTracing } from "./tracing.js";
import { startEvents } from "./events/bootstrap.js";

export async function setupOrchid(settings?: Settings): Promise<void> {
    const s = settings || getSettings();

    configureTracing({
        enabled: s.langsmith_tracing,
        apiKey: s.langsmith_api_key,
        project: s.langsmith_project,
    });

    // Identity resolver (optional)
    if (s.identity_resolver_class) {
        appCtx.identityResolver = (await importClass(
            s.identity_resolver_class,
        )) as typeof appCtx.identityResolver;
    } else if (s.dev_auth_bypass) {
        appCtx.identityResolver = (await importClass(
            "./devIdentity.js#DevBypassIdentityResolver",
        )) as typeof appCtx.identityResolver;
    }

    // Auth config provider (optional)
    if (s.auth_config_provider_class) {
        appCtx.authConfigProvider = (await importClass(
            s.auth_config_provider_class,
        )) as typeof appCtx.authConfigProvider;
    }

    // Auth exchange client (optional)
    if (s.auth_exchange_client_class) {
        appCtx.authExchangeClient = (await importClass(
            s.auth_exchange_client_class,
        )) as typeof appCtx.authExchangeClient;
    }

    // Build the Orchid facade
    const OrchidModule = await import("@orchid-ai/orchid");
    const Orchid = (
        OrchidModule as unknown as { Orchid: (typeof import("@orchid-ai/orchid"))["Orchid"] }
    ).Orchid;
    const loadOrchidConfig = (
        OrchidModule as unknown as {
            loadOrchidConfig?: (configPath: string) => Promise<unknown>;
        }
    ).loadOrchidConfig;

    const configPath = process.env["ORCHID_CONFIG"] || "";
    const overrides: Partial<OrchidFactoryOverrides> = {
        model: s.litellm_model,
        vectorBackend: s.vector_backend,
        qdrantUrl: s.qdrant_url,
        embeddingModel: s.embedding_model,
        storage: {
            chatStorageClass: s.chat_storage_class,
            chatDbDsn: s.chat_db_dsn,
            chatExtraMigrationsPackage: s.chat_extra_migrations_package || null,
        },
        mcpStorage: {
            mcpTokenStoreClass: s.mcp_token_store_class,
            mcpTokenStoreDsn: s.mcp_token_store_dsn,
            mcpClientRegistrationStoreClass: s.mcp_client_registration_store_class,
            mcpClientRegistrationStoreDsn: s.mcp_client_registration_store_dsn,
            mcpGatewayStateStoreClass: s.mcp_gateway_state_store_class,
            mcpGatewayStateStoreDsn: s.mcp_gateway_state_store_dsn,
        },
        checkpointer: {
            checkpointerType: s.checkpointer_type,
            checkpointerDsn: s.checkpointer_dsn,
        },
        startup: {
            startupHook: s.startup_hook,
            startupHookKwargs: { settings: s },
        },
        runtimeOverrides: { upload_namespace: s.upload_namespace },
    };

    appCtx.orchid = (await Orchid.fromConfigPath(
        configPath || s.agents_config_path,
        overrides,
    )) as Orchid;

    if (loadOrchidConfig) {
        try {
            const config = await loadOrchidConfig(configPath || s.agents_config_path);
            (appCtx.orchid.runtime as { config?: unknown }).config = config;
        } catch {
            // Non-fatal: routers fall back to runtime state when config can't be reloaded.
        }
    }

    await initialiseRuntimeStores(s);

    // Startup hook (RAG seeding, etc.)
    try {
        await runStartupHooks(s.startup_hook, appCtx.orchid);
    } catch {
        // Swallow — startup hook failures never abort startup
    }

    // OAuth state store
    const mcpModule = await import("@orchid-ai/orchid/mcp");
    const storeMod = mcpModule.InMemoryOAuthStateStore as { new (): OrchidOAuthStateStore };
    appCtx.oauthStateStore = new storeMod();

    // Proactive MCP capability warm-up for auth.mode: none servers
    try {
        const orchid = appCtx.orchid as unknown as {
            warmUnauthenticatedCapabilities?: () => Promise<void>;
        };
        if (orchid.warmUnauthenticatedCapabilities) {
            await orchid.warmUnauthenticatedCapabilities();
        }
    } catch {
        // Swallow — warm failures never abort startup
    }

    // Events subsystem (Pollen + Bloom) — disabled by default
    const runtimeConfig = ((appCtx.orchid.runtime as { config?: unknown }).config ??
        null) as unknown;
    appCtx.events = await startEvents(runtimeConfig);
}

async function importClass(dottedPath: string): Promise<unknown> {
    const parts = dottedPath.split("#");
    const modulePath = parts[0]!;
    const exportName = parts.length > 1 ? parts[1] : "default";

    const mod = await import(modulePath);
    if (exportName === "default") {
        const cls = (mod as { default?: unknown }).default;
        if (typeof cls === "function") return new (cls as new () => unknown)();
        return cls;
    }
    const cls = (mod as Record<string, unknown>)[exportName];
    if (typeof cls === "function" && /^[A-Z]/.test(exportName)) {
        return new (cls as new () => unknown)();
    }
    return cls;
}

export async function teardownOrchid(): Promise<void> {
    await releaseResources();
}

async function releaseResources(): Promise<void> {
    // Stop events first
    if (appCtx.events && (appCtx.events as { enabled?: boolean }).enabled) {
        try {
            const { stopEvents } = await import("./events/bootstrap.js");
            await stopEvents(appCtx.events);
        } catch {
            // Swallow
        }
        appCtx.events = null;
    }

    if (appCtx.orchid) {
        const runtime = appCtx.orchid.runtime as {
            chatStorage?: OrchidChatStorage | null;
            mcpTokenStore?: OrchidMCPTokenStore | null;
            mcpClientRegistrationStore?: OrchidMCPClientRegistrationStoreABC | null;
            mcpGatewayStateStore?:
                | (OrchidMCPGatewayClientStoreABC &
                      OrchidMCPGatewayAuthCodeStoreABC &
                      OrchidMCPGatewayTokenStoreABC)
                | null;
        };
        for (const resource of [
            runtime.chatStorage,
            runtime.mcpTokenStore,
            runtime.mcpClientRegistrationStore,
            runtime.mcpGatewayStateStore,
        ]) {
            try {
                if (resource?.close) {
                    await resource.close();
                }
            } catch {
                // Best-effort shutdown
            }
        }
        await appCtx.orchid.close();
        appCtx.orchid = null;
    }

    if (appCtx.oauthStateStore) {
        try {
            const store = appCtx.oauthStateStore as { close?(): Promise<void> };
            if (store.close) await store.close();
        } catch {
            // Swallow
        }
        appCtx.oauthStateStore = null;
    }

    appCtx.identityResolver = null;
    appCtx.authConfigProvider = null;
    appCtx.authExchangeClient = null;
}

async function initialiseRuntimeStores(settings: Settings): Promise<void> {
    if (!appCtx.orchid) return;

    const persistence = await import("@orchid-ai/orchid/persistence");
    const runtime = appCtx.orchid.runtime as {
        chatStorage?: OrchidChatStorage | null;
        mcpTokenStore?: OrchidMCPTokenStore | null;
        mcpClientRegistrationStore?: OrchidMCPClientRegistrationStoreABC | null;
        mcpGatewayStateStore?:
            | (OrchidMCPGatewayClientStoreABC &
                  OrchidMCPGatewayAuthCodeStoreABC &
                  OrchidMCPGatewayTokenStoreABC)
            | null;
    };

    if (!runtime.chatStorage) {
        const chatStorage = await buildChatStorageInstance(
            persistence,
            settings.chat_storage_class,
            settings.chat_db_dsn,
        );
        await chatStorage.initDb();
        runtime.chatStorage = chatStorage;
    }

    if (!runtime.mcpTokenStore) {
        const tokenStore = await buildMCPTokenStoreInstance(
            persistence,
            settings.mcp_token_store_class,
            settings.mcp_token_store_dsn,
        );
        await tokenStore.initDb();
        runtime.mcpTokenStore = tokenStore;
    }

    if (!runtime.mcpClientRegistrationStore) {
        const registrationStore = await buildRegistrationStoreInstance(
            persistence,
            settings.mcp_client_registration_store_class,
            settings.mcp_client_registration_store_dsn,
        );
        await registrationStore.initDb();
        runtime.mcpClientRegistrationStore = registrationStore;
    }

    if (!runtime.mcpGatewayStateStore) {
        const gatewayStateStore = await buildGatewayStateStoreInstance(
            persistence,
            settings.mcp_gateway_state_store_class,
            settings.mcp_gateway_state_store_dsn,
        );
        await gatewayStateStore.initDb();
        runtime.mcpGatewayStateStore = gatewayStateStore;
    }
}

async function buildChatStorageInstance(
    persistence: typeof import("@orchid-ai/orchid/persistence"),
    className: string,
    dsn: string,
): Promise<OrchidChatStorage> {
    const resolved = normaliseBuiltinClass(className, "chat");
    if (resolved === "sqlite") {
        return new persistence.OrchidSQLiteChatStorage(dsn);
    }
    const cls = (await importStorageClass(className)) as new (opts: { dsn: string }) => OrchidChatStorage;
    return new cls({ dsn });
}

async function buildMCPTokenStoreInstance(
    persistence: typeof import("@orchid-ai/orchid/persistence"),
    className: string,
    dsn: string,
): Promise<OrchidMCPTokenStore> {
    const resolved = normaliseBuiltinClass(className, "mcpToken");
    if (resolved === "sqlite") {
        return new persistence.OrchidSQLiteMCPTokenStore(dsn);
    }
    const cls = (await importStorageClass(className)) as new (opts: { dsn: string }) => OrchidMCPTokenStore;
    return new cls({ dsn });
}

async function buildRegistrationStoreInstance(
    persistence: typeof import("@orchid-ai/orchid/persistence"),
    className: string,
    dsn: string,
): Promise<OrchidMCPClientRegistrationStoreABC> {
    const resolved = normaliseBuiltinClass(className, "mcpRegistration");
    if (resolved === "sqlite") {
        return new persistence.OrchidSQLiteMCPClientRegistrationStore(dsn);
    }
    const cls = (await importStorageClass(className)) as new (opts: {
        dsn: string;
    }) => OrchidMCPClientRegistrationStoreABC;
    return new cls({ dsn });
}

async function buildGatewayStateStoreInstance(
    persistence: typeof import("@orchid-ai/orchid/persistence"),
    className: string,
    dsn: string,
): Promise<
    OrchidMCPGatewayClientStoreABC & OrchidMCPGatewayAuthCodeStoreABC & OrchidMCPGatewayTokenStoreABC
> {
    const resolved = normaliseBuiltinClass(className, "mcpGatewayState");
    if (resolved === "sqlite") {
        return new persistence.OrchidSQLiteMCPGatewayStateStore(dsn);
    }
    const cls = (await importStorageClass(className)) as new (opts: {
        dsn: string;
    }) => OrchidMCPGatewayClientStoreABC &
        OrchidMCPGatewayAuthCodeStoreABC &
        OrchidMCPGatewayTokenStoreABC;
    return new cls({ dsn });
}

async function importStorageClass(className: string): Promise<unknown> {
    const parts = className.split("#");
    const modulePath = parts[0]!;
    const exportName = parts.length > 1 ? parts[1] : "default";

    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");

    let resolvedPath: string;
    if (modulePath.startsWith(".")) {
        resolvedPath = resolve(process.cwd(), modulePath);
    } else {
        resolvedPath = modulePath;
    }

    const mod = await import(pathToFileURL(resolvedPath).href);
    const cls = mod[exportName] ?? mod;
    if (typeof cls !== "function") {
        throw new Error(`Storage class '${className}' resolved to non-function`);
    }
    return cls;
}

function normaliseBuiltinClass(
    className: string,
    _kind: "chat" | "mcpToken" | "mcpRegistration" | "mcpGatewayState",
): "sqlite" | null {
    const trimmed = className.trim();
    if (trimmed === "" || trimmed === "sqlite") {
        return "sqlite";
    }

    const aliases: Record<string, "sqlite"> = {
        "orchid_ai.persistence.sqlite.OrchidSQLiteChatStorage": "sqlite",
        "orchid_ai.persistence.mcp_token_sqlite.OrchidSQLiteMCPTokenStore": "sqlite",
        "orchid_ai.persistence.mcp_client_registration_sqlite.OrchidSQLiteMCPClientRegistrationStore":
            "sqlite",
        "orchid_ai.persistence.mcp_gateway_state_sqlite.OrchidSQLiteMCPGatewayStateStore": "sqlite",
    };

    const alias = aliases[trimmed];
    if (alias) return alias;

    return null;
}
