// SSE stream buffering helper

export interface StreamEvent {
    event?: string;
    data: string;
    id?: string;
    retry?: number;
}

export function eventToSSE(event: StreamEvent): string {
    const lines: string[] = [];
    if (event.event) lines.push(`event: ${event.event}`);
    if (event.id) lines.push(`id: ${event.id}`);
    if (event.retry) lines.push(`retry: ${event.retry}`);

    for (const line of event.data.split("\n")) {
        lines.push(`data: ${line}`);
    }
    lines.push(""); // Empty line terminates the event
    return lines.join("\n");
}

export function createDoneEvent(): StreamEvent {
    return { event: "done", data: JSON.stringify({ type: "DONE" }) };
}

export function createErrorEvent(message: string): StreamEvent {
    return { event: "error", data: JSON.stringify({ type: "ERROR", message }) };
}

export function createChunkEvent(content: string): StreamEvent {
    return { data: JSON.stringify({ type: "CHUNK", content }) };
}

export function createToolStartEvent(toolName: string): StreamEvent {
    return { data: JSON.stringify({ type: "TOOL_START", tool: toolName }) };
}

export function createToolEndEvent(toolName: string, result: string): StreamEvent {
    return { data: JSON.stringify({ type: "TOOL_END", tool: toolName, result }) };
}
