import { describe, it, expect } from "vitest";
import { OrchidAuthContext } from "@orchid-ai/orchid/core";
import { buildInterruptResponse } from "../../src/helpers/state.js";

describe("buildInterruptResponse", () => {
    it("builds interrupt response from GraphInterrupt error", () => {
        const interruptError = {
            name: "GraphInterrupt",
            approvals: [
                {
                    tool: "write_file",
                    args: { path: "/tmp/test" },
                    agent: "test-agent",
                    interruptId: "int-001",
                },
                {
                    tool: "execute_command",
                    args: { command: "ls" },
                    agent: "test-agent",
                },
            ],
            message: "Tool approval needed",
        };

        const result = buildInterruptResponse(interruptError, "chat-1", "tenant-1");
        expect(result.status).toBe("interrupted");
        expect(result.chat_id).toBe("chat-1");
        expect(result.tenant_id).toBe("tenant-1");
        expect(result.approvals_needed).toHaveLength(2);
        expect(result.approvals_needed[0]!.tool).toBe("write_file");
        expect(result.approvals_needed[0]!.interrupt_id).toBe("int-001");
        expect(result.approvals_needed[1]!.tool).toBe("execute_command");
        expect(result.approvals_needed[1]!.interrupt_id).toBe("");
    });

    it("handles error with no approvals", () => {
        const interruptError = { name: "GraphInterrupt" };
        const result = buildInterruptResponse(interruptError, "chat-1", "t1");
        expect(result.approvals_needed).toEqual([]);
    });
});
