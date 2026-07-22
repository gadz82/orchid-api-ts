import type { OrchidAuthContext } from "@orchid-ai/orchid/core";
import type { OrchidChatStorage } from "@orchid-ai/orchid/persistence";

import { type InterruptResponse } from "../models.js";

export interface PreparedGraphState {
    initialState: Record<string, unknown>;
    message: string;
    historyRows: number;
    mcpAuthStatus: Record<string, boolean>;
    chatId: string;
}

/**
 * Build the initial graph state for a new message.
 *
 * When a checkpointer is active, only the new user message is sent —
 * LangGraph restores prior state from the checkpointer. When no
 * checkpointer is configured, all persisted conversation history is
 * prepended so the graph has full context (Python parity).
 */
export async function prepareGraphState(
    chatId: string,
    message: string,
    _files: Array<{ filename: string; data: Buffer; mimetype: string }>,
    _auth: OrchidAuthContext,
    _settings: unknown,
    chatRepo: OrchidChatStorage,
    _runtime: unknown,
    _mcpTokenStore: unknown,
    hasCheckpointer = false,
): Promise<PreparedGraphState> {
    const historyMessages = await chatRepo.getMessages(chatId);
    const historyRows = historyMessages.length;

    const messages: Array<Record<string, unknown>> = [];

    // Prepend persisted history when there's no checkpointer to
    // restore it (Python parity: `build_initial_graph_state`).
    if (!hasCheckpointer) {
        for (const row of historyMessages) {
            if (row.role === "user") {
                messages.push({ type: "human", content: row.content, id: row.id });
            } else if (row.role === "assistant") {
                messages.push({ type: "ai", content: row.content, id: row.id });
            }
        }
    }

    messages.push({
        type: "human",
        content: message,
        id: crypto.randomUUID(),
    });

    const state: Record<string, unknown> = {
        messages,
        // GraphState uses camelCase channel names (`chatId`). The
        // older snake_case field (`chat_id`) is not declared as a
        // LangGraph channel — it would be silently dropped at the
        // channel boundary, leaving supervisor/agents reading
        // `state.chatId === undefined` and breaking RAG scoping.
        chatId,
        // Back-compat: keep the snake_case alias for consumers that
        // still read it directly from the raw state dict.
        chat_id: chatId,
    };

    return {
        initialState: state,
        message,
        historyRows,
        mcpAuthStatus: {},
        chatId,
    };
}

export async function verifyChatOwnership(
    chatId: string,
    auth: OrchidAuthContext,
    chatRepo: OrchidChatStorage,
): Promise<void> {
    const chat = await chatRepo.getChat(chatId);
    if (!chat) {
        throw Object.assign(new Error("Chat not found"), { statusCode: 404 });
    }
    if (chat.tenantId !== auth.tenantKey || chat.userId !== auth.userId) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
}

export function buildInterruptResponse(
    interruptError: unknown,
    chatId: string,
    tenantId: string,
): InterruptResponse {
    const err = interruptError as {
        approvals?: Array<{
            tool: string;
            args: Record<string, unknown>;
            agent: string;
            interruptId?: string;
        }>;
    };
    const approvals = err.approvals ?? [];
    return {
        chat_id: chatId,
        tenant_id: tenantId,
        status: "interrupted",
        approvals_needed: approvals.map((a) => ({
            tool: a.tool,
            args: a.args,
            agent: a.agent,
            interrupt_id: a.interruptId ?? "",
        })),
    };
}

export async function autoTitleIfFirstMessage(
    chatId: string,
    message: string,
    historyRows: number,
    chatRepo: OrchidChatStorage,
): Promise<void> {
    if (historyRows > 0) return;

    const title = message.slice(0, 80) + (message.length > 80 ? "..." : "");
    await chatRepo.updateTitle(chatId, title);
}
