import type { Orchid } from "@orchid-ai/orchid";
import type { OrchidAuthContext } from "@orchid-ai/orchid/core";
import type {
    OrchidIdentityResolver,
    OrchidAuthConfigProvider,
    OrchidAuthExchangeClient,
} from "@orchid-ai/orchid/core";
import type { OrchidChatStorage } from "@orchid-ai/orchid/persistence";
import type { OrchidMCPTokenStore } from "@orchid-ai/orchid/core";
import type { OrchidMCPClientRegistrationStoreABC } from "@orchid-ai/orchid/core";
import type { OrchidOAuthStateStore } from "@orchid-ai/orchid/mcp";
import type {
    OrchidMCPGatewayClientStoreABC,
    OrchidMCPGatewayAuthCodeStoreABC,
    OrchidMCPGatewayTokenStoreABC,
} from "@orchid-ai/orchid/core";

export interface AppContext {
    orchid: Orchid | null;
    identityResolver: OrchidIdentityResolver | null;
    authConfigProvider: OrchidAuthConfigProvider | null;
    authExchangeClient: OrchidAuthExchangeClient | null;
    oauthStateStore: OrchidOAuthStateStore | null;
    events: unknown;
}

export const appCtx: AppContext = {
    orchid: null,
    identityResolver: null,
    authConfigProvider: null,
    authExchangeClient: null,
    oauthStateStore: null,
    events: null,
};

declare module "fastify" {
    interface FastifyRequest {
        authContext?: OrchidAuthContext;
    }
}

export function getOrchid(): Orchid {
    if (!appCtx.orchid) {
        throw Object.assign(new Error("Orchid not initialised"), { statusCode: 503 });
    }
    return appCtx.orchid;
}

export function getChatStorage(): OrchidChatStorage {
    const orchid = getOrchid();
    const runtime = orchid.runtime as { chatStorage?: OrchidChatStorage };
    const storage = runtime.chatStorage ?? orchid.chatStorage;
    if (!storage) {
        throw Object.assign(new Error("Chat storage not initialised"), { statusCode: 503 });
    }
    return storage;
}

export function getMCPTokenStore(): OrchidMCPTokenStore {
    const orchid = getOrchid();
    const runtime = orchid.runtime as { mcpTokenStore?: OrchidMCPTokenStore };
    const store = runtime.mcpTokenStore;
    if (!store) {
        throw Object.assign(new Error("MCP token store not initialised"), { statusCode: 503 });
    }
    return store;
}

export function getMCPTokenStoreOptional(): OrchidMCPTokenStore | null {
    if (!appCtx.orchid) return null;
    const runtime = appCtx.orchid.runtime as { mcpTokenStore?: OrchidMCPTokenStore };
    return runtime.mcpTokenStore ?? null;
}

export function getMCPClientRegistrationStore(): OrchidMCPClientRegistrationStoreABC {
    if (!appCtx.orchid) {
        throw Object.assign(new Error("MCP client-registration store not initialised"), {
            statusCode: 503,
        });
    }
    const runtime = appCtx.orchid.runtime as {
        mcpClientRegistrationStore?: OrchidMCPClientRegistrationStoreABC;
    };
    const store = runtime.mcpClientRegistrationStore;
    if (!store) {
        throw Object.assign(new Error("MCP client-registration store not initialised"), {
            statusCode: 503,
        });
    }
    return store;
}

export function getMCPClientRegistrationStoreOptional(): OrchidMCPClientRegistrationStoreABC | null {
    if (!appCtx.orchid) return null;
    const runtime = appCtx.orchid.runtime as {
        mcpClientRegistrationStore?: OrchidMCPClientRegistrationStoreABC;
    };
    return runtime.mcpClientRegistrationStore ?? null;
}

export function getOAuthStateStore(): OrchidOAuthStateStore {
    if (!appCtx.oauthStateStore) {
        throw Object.assign(new Error("OAuth state store not initialised"), { statusCode: 503 });
    }
    return appCtx.oauthStateStore;
}

export function getIdentityResolver(): OrchidIdentityResolver {
    if (!appCtx.identityResolver) {
        throw Object.assign(new Error("Identity resolver not configured"), { statusCode: 503 });
    }
    return appCtx.identityResolver;
}

export function getAuthConfigProvider(): OrchidAuthConfigProvider {
    if (!appCtx.authConfigProvider) {
        throw Object.assign(new Error("Auth config provider not configured"), { statusCode: 503 });
    }
    return appCtx.authConfigProvider;
}

export function getAuthExchangeClient(): OrchidAuthExchangeClient {
    if (!appCtx.authExchangeClient) {
        throw Object.assign(new Error("Auth exchange client not configured"), { statusCode: 503 });
    }
    return appCtx.authExchangeClient;
}

export function getAgentsConfig(): unknown {
    const orchid = getOrchid();
    const runtime = orchid.runtime as { config?: unknown };
    const config = runtime.config;
    if (!config) {
        throw Object.assign(new Error("Agents config not loaded"), { statusCode: 503 });
    }
    return config;
}

export function getAgentsConfigOptional(): unknown {
    if (!appCtx.orchid) return null;
    const runtime = appCtx.orchid.runtime as { config?: unknown };
    return runtime.config ?? null;
}

export function getMCPGatewayStateStore(): OrchidMCPGatewayClientStoreABC &
    OrchidMCPGatewayAuthCodeStoreABC &
    OrchidMCPGatewayTokenStoreABC {
    const orchid = getOrchid();
    const runtime = orchid.runtime as {
        mcpGatewayStateStore?: OrchidMCPGatewayClientStoreABC &
            OrchidMCPGatewayAuthCodeStoreABC &
            OrchidMCPGatewayTokenStoreABC;
    };
    const store = runtime.mcpGatewayStateStore;
    if (!store) {
        throw Object.assign(new Error("MCP gateway state store not initialised"), {
            statusCode: 503,
        });
    }
    return store;
}

export function getEventsRuntime<T = unknown>(): T {
    const runtime = appCtx.events as { enabled?: boolean } | null;
    if (!runtime || !runtime.enabled) {
        throw Object.assign(new Error("Events subsystem is disabled"), { statusCode: 503 });
    }
    return appCtx.events as T;
}
