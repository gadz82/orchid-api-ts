import { z } from "zod";

// Request schemas (snake_case matching Python API)

export const CreateChatRequestSchema = z.object({
    title: z.string().default(""),
});

export const SendMessageRequestSchema = z.object({
    message: z.string(),
});

export const IndexRequestSchema = z.object({
    tenant_id: z.string().default("default"),
});

// Response schemas

export const ChatResponseSchema = z.object({
    response: z.string(),
    chat_id: z.string(),
    tenant_id: z.string(),
    agents_used: z.array(z.string()),
    auth_required: z.array(z.string()).default([]),
});

export const ToolApprovalRequestSchema = z.object({
    tool: z.string(),
    args: z.record(z.unknown()).default({}),
    agent: z.string().default(""),
    interrupt_id: z.string().default(""),
});

export const InterruptResponseSchema = z.object({
    chat_id: z.string(),
    tenant_id: z.string(),
    status: z.string().default("interrupted"),
    approvals_needed: z.array(ToolApprovalRequestSchema),
});

export const ChatSessionOutSchema = z.object({
    id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    is_shared: z.boolean(),
});

export const MessageOutSchema = z.object({
    id: z.string(),
    role: z.string(),
    content: z.string(),
    agents_used: z.array(z.string()),
    created_at: z.string(),
    metadata: z.record(z.unknown()).nullable().default(null),
});

export const IndexResponseSchema = z.object({
    status: z.string(),
    tenant_id: z.string(),
    indexed: z.record(z.number()),
});

export const UploadFileResultSchema = z.object({
    filename: z.string(),
    chunks_indexed: z.number().nullable().default(null),
    error: z.string().nullable().default(null),
});

export const UploadResponseSchema = z.object({
    status: z.string(),
    files: z.array(UploadFileResultSchema),
});

// Type exports

export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type IndexRequest = z.infer<typeof IndexRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type ToolApprovalRequest = z.infer<typeof ToolApprovalRequestSchema>;
export type InterruptResponse = z.infer<typeof InterruptResponseSchema>;
export type ChatSessionOut = z.infer<typeof ChatSessionOutSchema>;
export type MessageOut = z.infer<typeof MessageOutSchema>;
export type IndexResponse = z.infer<typeof IndexResponseSchema>;
export type UploadFileResult = z.infer<typeof UploadFileResultSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
