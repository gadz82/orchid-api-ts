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

export async function prepareGraphState(
    chatId: string,
    message: string,
    _files: Array<{ filename: string; data: Buffer; mimetype: string }>,
    _auth: OrchidAuthContext,
    _settings: unknown,
    chatRepo: OrchidChatStorage,
    _runtime: unknown,
    _mcpTokenStore: unknown,
): Promise<PreparedGraphState> {
    const historyMessages = await chatRepo.getMessages(chatId);
    const historyRows = historyMessages.length;

    const state: Record<string, unknown> = {
        messages: [
            {
                type: "human",
                content: message,
                id: crypto.randomUUID(),
            },
        ],
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
