import type { OrchidAuthContext } from "@orchid-ai/orchid/core";

export interface VisibilityFilter {
    tenant_id: string;
    user_id?: string;
    chat_id?: string;
    agent_id?: string;
    roles?: string[];
}

export function buildVisibilityFilter(auth: OrchidAuthContext): VisibilityFilter {
    return {
        tenant_id: auth.tenantKey,
        user_id: auth.userId,
        roles: Array.from(auth.roles ?? []),
    };
}

export function applyVisibilityFilter(
    records: Array<Record<string, unknown>>,
    filter: VisibilityFilter,
): Array<Record<string, unknown>> {
    return records.filter((record) => {
        // Must match tenant
        if (record["tenant_id"] !== filter.tenant_id) return false;

        // If user-scoped, must match user unless admin
        if (filter.user_id) {
            const recordUserId = record["user_id"] as string;
            if (recordUserId && recordUserId !== filter.user_id) {
                // Check for admin role if available
                if (!filter.roles?.includes("admin")) return false;
            }
        }
        return true;
    });
}

export function scopedVisibilityFilter(
    auth: OrchidAuthContext,
    records: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    return applyVisibilityFilter(records, buildVisibilityFilter(auth));
}
