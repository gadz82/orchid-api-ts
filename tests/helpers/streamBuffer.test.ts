import { describe, it, expect } from "vitest";
import {
    eventToSSE,
    createDoneEvent,
    createErrorEvent,
    createChunkEvent,
    createStatusEvent,
    createSkillEvent,
    createToolStartEvent,
    createToolEndEvent,
    processStreamChunk,
    createStreamProcessingState,
} from "../../src/helpers/streamBuffer.js";

describe("eventToSSE", () => {
    it("formats a simple data event", () => {
        const result = eventToSSE({ data: "hello" });
        expect(result).toBe("data: hello\n\n");
    });

    it("formats an event with event name", () => {
        const result = eventToSSE({ event: "done", data: "{}" });
        expect(result).toBe("event: done\ndata: {}\n\n");
    });

    it("formats an event with id", () => {
        const result = eventToSSE({ data: "test", id: "msg-1" });
        expect(result).toContain("id: msg-1");
    });

    it("formats multi-line data", () => {
        const result = eventToSSE({ data: "line1\nline2" });
        expect(result).toBe("data: line1\ndata: line2\n\n");
    });

    it("includes retry field", () => {
        const result = eventToSSE({ data: "test", retry: 5000 });
        expect(result).toContain("retry: 5000");
    });
});

describe("createDoneEvent", () => {
    it("creates a done event with no response", () => {
        const event = createDoneEvent();
        expect(JSON.parse(event.data)).toEqual({
            type: "done",
            response: "",
            agents_used: [],
            agent_results: {},
            auth_required: [],
            timed_out: false,
            cancelled: false,
            error: false,
        });
    });

    it("creates a done event with response", () => {
        const event = createDoneEvent("Hello from agent", ["basketball"], { basketball: "text" });
        expect(JSON.parse(event.data)).toEqual({
            type: "done",
            response: "Hello from agent",
            agents_used: ["basketball"],
            agent_results: { basketball: "text" },
            auth_required: [],
            timed_out: false,
            cancelled: false,
            error: false,
        });
    });
});

describe("createErrorEvent", () => {
    it("creates an error event with message", () => {
        const event = createErrorEvent("Something went wrong");
        expect(JSON.parse(event.data)).toEqual({ type: "error", message: "Something went wrong" });
    });
});

describe("createChunkEvent", () => {
    it("creates a chunk event with content", () => {
        const event = createChunkEvent("Hello, world!");
        expect(JSON.parse(event.data)).toEqual({ type: "token", content: "Hello, world!" });
    });
});

describe("createToolStartEvent", () => {
    it("creates a tool start event", () => {
        const event = createToolStartEvent("write_file");
        expect(JSON.parse(event.data)).toEqual({ type: "tool.started", tool: "write_file" });
    });
});

describe("createToolEndEvent", () => {
    it("creates a tool end event", () => {
        const event = createToolEndEvent("write_file", "File written successfully");
        const parsed = JSON.parse(event.data);
        expect(parsed).toEqual({
            type: "tool.finished",
            tool: "write_file",
            result: "File written successfully",
        });
    });
});

describe("createStatusEvent", () => {
    it("creates a status started event", () => {
        const event = createStatusEvent("basketball", "started");
        expect(JSON.parse(event.data)).toEqual({
            type: "status",
            agent: "basketball",
            status: "started",
        });
    });

    it("creates a status done event with preview", () => {
        const event = createStatusEvent("basketball", "done", "LeBron James is...");
        expect(JSON.parse(event.data)).toEqual({
            type: "status",
            agent: "basketball",
            status: "done",
            preview: "LeBron James is...",
        });
    });
});

describe("createSkillEvent", () => {
    it("creates a skill adopted event", () => {
        const event = createSkillEvent("basketball", "scouting_report");
        expect(JSON.parse(event.data)).toEqual({
            type: "skill.adopted",
            agent: "basketball",
            skill: "scouting_report",
        });
    });
});

describe("processStreamChunk", () => {
    it("emits supervisor final response as tokens", () => {
        const state = createStreamProcessingState();
        const events = processStreamChunk(
            {
                supervisor: {
                    messages: [{ role: "ai", content: "Final answer" }],
                    finalResponse: "Final answer",
                },
            },
            state,
        );

        expect(events).toHaveLength(1);
        expect(JSON.parse(events[0]!.data)).toEqual({ type: "token", content: "Final answer" });
        expect(state.fullResponse).toBe("Final answer");
    });

    it("emits agent status events but no tokens", () => {
        const state = createStreamProcessingState();
        const events = processStreamChunk(
            {
                basketball_agent: {
                    messages: [{ role: "ai", content: "[Basketball Agent] LeBron stats" }],
                    activeAgents: [],
                },
            },
            state,
        );

        const parsed = events.map((e) => JSON.parse(e.data));
        expect(parsed).toContainEqual({ type: "status", agent: "basketball", status: "started" });
        expect(parsed).toContainEqual({
            type: "status",
            agent: "basketball",
            status: "done",
            preview: "LeBron stats",
        });
        expect(parsed.some((p) => p.type === "token")).toBe(false);
        expect(state.agentResults).toEqual({ basketball: "LeBron stats" });
    });

    it("skips supervisor routing messages as tokens", () => {
        const state = createStreamProcessingState();
        const events = processStreamChunk(
            {
                supervisor: {
                    messages: [
                        { role: "ai", content: "[Supervisor] Parallel dispatch: basketball" },
                    ],
                    activeAgents: ["basketball"],
                },
            },
            state,
        );

        const parsed = events.map((e) => JSON.parse(e.data));
        expect(parsed).toContainEqual({ type: "status", agent: "basketball", status: "started" });
        expect(parsed.some((p) => p.type === "token")).toBe(false);
    });

    it("does not re-emit historical assistant messages", () => {
        const state = createStreamProcessingState();
        // A values-mode style full state should not cause old assistant
        // content to be streamed as a token.
        const events = processStreamChunk(
            {
                supervisor: {
                    messages: [
                        { role: "ai", content: "Old answer from history" },
                        { role: "ai", content: "[Supervisor] Parallel dispatch: basketball" },
                    ],
                    activeAgents: ["basketball"],
                },
            },
            state,
        );

        const parsed = events.map((e) => JSON.parse(e.data));
        expect(parsed.some((p) => p.content === "Old answer from history")).toBe(false);
        expect(state.fullResponse).toBe("");
    });

    it("emits skill adopted events from agent messages", () => {
        const state = createStreamProcessingState();
        const events = processStreamChunk(
            {
                basketball_agent: {
                    messages: [
                        {
                            role: "ai",
                            content: "Running agent skill 'scoutingReport'",
                        },
                    ],
                },
            },
            state,
        );

        const parsed = events.map((e) => JSON.parse(e.data));
        expect(parsed).toContainEqual({
            type: "skill.adopted",
            agent: "basketball",
            skill: "scoutingReport",
        });
    });

    it("handles synthesis overwriting prior agent output", () => {
        const state = createStreamProcessingState();
        processStreamChunk(
            {
                basketball_agent: {
                    messages: [{ role: "ai", content: "[Basketball Agent] Agent output" }],
                },
            },
            state,
        );
        const events = processStreamChunk(
            {
                supervisor: {
                    messages: [{ role: "ai", content: "Synthesised answer" }],
                    finalResponse: "Synthesised answer",
                },
            },
            state,
        );

        expect(events).toHaveLength(1);
        expect(JSON.parse(events[0]!.data)).toEqual({
            type: "token",
            content: "Synthesised answer",
        });
        expect(state.fullResponse).toBe("Synthesised answer");
    });
});
