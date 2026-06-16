import { JobStatus, type JobRun, type Signal } from "@orchid-ai/orchid/core";
import type { OrchidAuthContext } from "@orchid-ai/orchid/core";
import type { OrchidChatStorage } from "@orchid-ai/orchid/persistence";

export function requireAdmin(auth: OrchidAuthContext): void {
    if (!auth.roles.has("admin")) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
    }
}

export function isSignalVisible(signal: Signal, auth: OrchidAuthContext): boolean {
    if (signal.tenantKey !== auth.tenantKey) return false;
    if (auth.roles.has("admin")) return true;
    return !signal.userId || signal.userId === auth.userId;
}

export function isRunVisible(run: JobRun, auth: OrchidAuthContext): boolean {
    const tenantKey = (run.metadata["tenant_key"] as string | undefined) ?? auth.tenantKey;
    if (tenantKey !== auth.tenantKey) return false;
    if (auth.roles.has("admin")) return true;
    if (run.spec.visibility === "admin") return false;
    if (run.spec.visibilityUserId) {
        return run.spec.visibilityUserId === auth.userId;
    }
    return true;
}

export function parseSince(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw Object.assign(new Error(`invalid 'since' timestamp: ${value}`), { statusCode: 400 });
    }
    return parsed;
}

export function serialiseSignal(signal: Signal): Record<string, unknown> {
    return {
        signal_id: signal.signalId,
        type: signal.type,
        source: signal.source,
        payload: signal.payload,
        tenant_key: signal.tenantKey,
        user_id: signal.userId,
        correlation_id: signal.correlationId,
        dedupe_key: signal.dedupeKey,
        identity_claim: signal.identityClaim,
        chat_binding: signal.chatBinding,
        occurred_at: signal.occurredAt.toISOString(),
        persisted_at: signal.persistedAt.toISOString(),
        relay_status: signal.relayStatus,
    };
}

export function serialiseRun(run: JobRun, includeResult = false): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        run_id: run.runId,
        trigger_id: run.spec.triggerId,
        signal_id: run.spec.signalId,
        agent_name: run.spec.agentName,
        attempt_number: run.attemptNumber,
        status: run.status,
        visibility: run.spec.visibility,
        visibility_user_id: run.spec.visibilityUserId,
        queued_at: run.queuedAt.toISOString(),
        started_at: run.startedAt?.toISOString() ?? null,
        finished_at: run.finishedAt?.toISOString() ?? null,
        error: run.error,
    };
    if (includeResult) {
        payload["result"] = run.result;
        payload["next_retry_at"] = run.nextRetryAt?.toISOString() ?? null;
    }
    return payload;
}

export async function requireChatOwnerOrAdmin(
    chatId: string,
    auth: OrchidAuthContext,
    chatRepo: OrchidChatStorage,
): Promise<void> {
    const chat = await chatRepo.getChat(chatId);
    if (!chat) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
    }
    if (chat.tenantId !== auth.tenantKey) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
    }
    if (chat.userId !== auth.userId && !auth.roles.has("admin")) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
    }
}

export function pendingStatuses(): readonly JobStatus[] {
    return [JobStatus.PENDING, JobStatus.RUNNING];
}
