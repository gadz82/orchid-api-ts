import { describe, it, expect } from "vitest";
import {
    CreateChatRequestSchema,
    ChatResponseSchema,
    InterruptResponseSchema,
    ChatSessionOutSchema,
    MessageOutSchema,
    UploadResponseSchema,
    UploadFileResultSchema,
} from "../src/models.js";

describe("CreateChatRequestSchema", () => {
    it("parses empty body to default title", () => {
        const result = CreateChatRequestSchema.parse({});
        expect(result.title).toBe("");
    });

    it("parses title from body", () => {
        const result = CreateChatRequestSchema.parse({ title: "My chat" });
        expect(result.title).toBe("My chat");
    });

    it("defaults missing title to empty string", () => {
        const result = CreateChatRequestSchema.safeParse({ title: undefined });
        expect(result.success).toBe(true);
        expect(result.success && result.data.title).toBe("");
    });
});

describe("ChatResponseSchema", () => {
    it("validates a complete response", () => {
        const result = ChatResponseSchema.parse({
            response: "Hello world",
            chat_id: "abc123",
            tenant_id: "default",
            agents_used: ["agent1"],
        });
        expect(result.response).toBe("Hello world");
        expect(result.chat_id).toBe("abc123");
        expect(result.auth_required).toEqual([]);
    });

    it("defaults auth_required to empty array", () => {
        const result = ChatResponseSchema.parse({
            response: "ok",
            chat_id: "abc",
            tenant_id: "default",
            agents_used: [],
        });
        expect(result.auth_required).toEqual([]);
    });
});

describe("InterruptResponseSchema", () => {
    it("validates interrupt with approvals", () => {
        const result = InterruptResponseSchema.parse({
            chat_id: "abc",
            tenant_id: "default",
            approvals_needed: [
                {
                    tool: "write_file",
                    args: { path: "/tmp/test" },
                    agent: "test",
                    interrupt_id: "int-1",
                },
            ],
        });
        expect(result.status).toBe("interrupted");
        expect(result.approvals_needed).toHaveLength(1);
        expect(result.approvals_needed[0]!.tool).toBe("write_file");
    });

    it("defaults status to interrupted", () => {
        const result = InterruptResponseSchema.parse({
            chat_id: "abc",
            tenant_id: "default",
            approvals_needed: [],
        });
        expect(result.status).toBe("interrupted");
    });
});

describe("ChatSessionOutSchema", () => {
    it("validates a session object", () => {
        const result = ChatSessionOutSchema.parse({
            id: "chat-1",
            title: "Test chat",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            is_shared: false,
        });
        expect(result.id).toBe("chat-1");
    });
});

describe("MessageOutSchema", () => {
    it("validates a message with null metadata", () => {
        const result = MessageOutSchema.parse({
            id: "msg-1",
            role: "user",
            content: "Hello",
            agents_used: [],
            created_at: "2026-01-01T00:00:00Z",
        });
        expect(result.metadata).toBeNull();
    });

    it("validates a message with metadata", () => {
        const result = MessageOutSchema.parse({
            id: "msg-1",
            role: "assistant",
            content: "Hi",
            agents_used: ["agent1"],
            created_at: "2026-01-01T00:00:00Z",
            metadata: { tokens: 100 },
        });
        expect(result.metadata).toEqual({ tokens: 100 });
    });
});

describe("UploadResponseSchema", () => {
    it("validates upload response with file results", () => {
        const result = UploadResponseSchema.parse({
            status: "ok",
            files: [
                { filename: "test.pdf", chunks_indexed: 5 },
                { filename: "bad.txt", error: "Unsupported type" },
            ],
        });
        expect(result.status).toBe("ok");
        expect(result.files).toHaveLength(2);
        expect(result.files[0]!.chunks_indexed).toBe(5);
        expect(result.files[1]!.error).toBe("Unsupported type");
    });
});

describe("UploadFileResultSchema", () => {
    it("defaults chunks_indexed and error to null", () => {
        const result = UploadFileResultSchema.parse({ filename: "test.pdf" });
        expect(result.chunks_indexed).toBeNull();
        expect(result.error).toBeNull();
    });
});
