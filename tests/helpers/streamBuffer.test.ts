import { describe, it, expect } from "vitest";
import {
    eventToSSE,
    createDoneEvent,
    createErrorEvent,
    createChunkEvent,
    createToolStartEvent,
    createToolEndEvent,
} from "../../src/helpers/streamBuffer.js";

describe("eventToSSE", () => {
    it("formats a simple data event", () => {
        const result = eventToSSE({ data: "hello" });
        expect(result).toBe("data: hello\n");
    });

    it("formats an event with event name", () => {
        const result = eventToSSE({ event: "done", data: "{}" });
        expect(result).toBe("event: done\ndata: {}\n");
    });

    it("formats an event with id", () => {
        const result = eventToSSE({ data: "test", id: "msg-1" });
        expect(result).toContain("id: msg-1");
    });

    it("formats multi-line data", () => {
        const result = eventToSSE({ data: "line1\nline2" });
        expect(result).toBe("data: line1\ndata: line2\n");
    });

    it("includes retry field", () => {
        const result = eventToSSE({ data: "test", retry: 5000 });
        expect(result).toContain("retry: 5000");
    });
});

describe("createDoneEvent", () => {
    it("creates a done event", () => {
        const event = createDoneEvent();
        expect(event.event).toBe("done");
        expect(JSON.parse(event.data)).toEqual({ type: "DONE" });
    });
});

describe("createErrorEvent", () => {
    it("creates an error event with message", () => {
        const event = createErrorEvent("Something went wrong");
        expect(event.event).toBe("error");
        expect(JSON.parse(event.data)).toEqual({ type: "ERROR", message: "Something went wrong" });
    });
});

describe("createChunkEvent", () => {
    it("creates a chunk event with content", () => {
        const event = createChunkEvent("Hello, world!");
        expect(JSON.parse(event.data)).toEqual({ type: "CHUNK", content: "Hello, world!" });
    });
});

describe("createToolStartEvent", () => {
    it("creates a tool start event", () => {
        const event = createToolStartEvent("write_file");
        expect(JSON.parse(event.data)).toEqual({ type: "TOOL_START", tool: "write_file" });
    });
});

describe("createToolEndEvent", () => {
    it("creates a tool end event", () => {
        const event = createToolEndEvent("write_file", "File written successfully");
        const parsed = JSON.parse(event.data);
        expect(parsed).toEqual({
            type: "TOOL_END",
            tool: "write_file",
            result: "File written successfully",
        });
    });
});
