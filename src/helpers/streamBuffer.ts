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
    lines.push(""); // SSE spec: frame ends with \n\n
    return lines.join("\n");
}

export function createDoneEvent(
    response?: string,
    agentsUsed?: string[],
    agentResults?: Record<string, string>,
): StreamEvent {
    return {
        data: JSON.stringify({
            type: "done",
            response: response ?? "",
            agents_used: agentsUsed ?? [],
            agent_results: agentResults ?? {},
            auth_required: [],
            timed_out: false,
            cancelled: false,
            error: false,
        }),
    };
}

export function createErrorEvent(message: string): StreamEvent {
    return { data: JSON.stringify({ type: "error", message }) };
}

export function createChunkEvent(content: string): StreamEvent {
    return { data: JSON.stringify({ type: "token", content }) };
}

export function createStatusEvent(agent: string, status: string, preview?: string): StreamEvent {
    return {
        data: JSON.stringify({
            type: "status",
            agent,
            status,
            ...(preview !== undefined ? { preview } : {}),
        }),
    };
}

export function createSkillEvent(agent: string, skill: string): StreamEvent {
    return { data: JSON.stringify({ type: "skill.adopted", agent, skill }) };
}

export function createToolStartEvent(toolName: string): StreamEvent {
    return { data: JSON.stringify({ type: "tool.started", tool: toolName }) };
}

export function createToolEndEvent(toolName: string, result: string): StreamEvent {
    return { data: JSON.stringify({ type: "tool.finished", tool: toolName, result }) };
}

const AGENT_PREFIX_RE = /^\[(\w+)\s+Agent\]\s*/;

export interface StreamProcessingState {
    fullResponse: string;
    agentsUsed: Set<string>;
    agentResults: Record<string, string>;
    startedAgents: Set<string>;
}

export function createStreamProcessingState(): StreamProcessingState {
    return {
        fullResponse: "",
        agentsUsed: new Set<string>(),
        agentResults: {},
        startedAgents: new Set<string>(),
    };
}

/**
 * Process a single graph stream chunk and produce the SSE events that
 * should be emitted.
 *
 * The streaming router uses LangGraph's "updates" mode, so each chunk is
 * `{ nodeName: partialState }`.  We route by node name so that historical
 * assistant messages are never re-emitted as tokens and agent outputs are
 * surfaced as status events rather than token events.
 *
 * As a defensive fallback for values-mode chunks, only the top-level
 * `finalResponse` / `final_response` field is ever streamed as a token;
 * the `messages` array is never scanned for "last AI content" because that
 * would replay conversation history.
 */
export function processStreamChunk(
    chunk: unknown,
    state: StreamProcessingState,
): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (chunk == null || typeof chunk !== "object") return events;

    const chunkObj = chunk as Record<string, unknown>;

    // Defensive values-mode handling: a full state object carries the
    // response in finalResponse.  Do NOT walk the messages array — that
    // would emit prior turns.
    const topLevelFinal =
        (chunkObj["final_response"] as string) || (chunkObj["finalResponse"] as string) || null;
    if (topLevelFinal) {
        pushTokenDelta(topLevelFinal, state, events);
        return events;
    }

    for (const [nodeName, partial] of Object.entries(chunkObj)) {
        if (!partial || typeof partial !== "object") continue;
        const partialObj = partial as Record<string, unknown>;

        if (nodeName === "supervisor") {
            // Track newly activated agents.
            const active = (partialObj["activeAgents"] as string[]) ?? [];
            for (const agent of active) {
                if (!state.startedAgents.has(agent)) {
                    state.startedAgents.add(agent);
                    events.push(createStatusEvent(agent, "started"));
                }
            }

            const msgs = (partialObj["messages"] as Array<Record<string, unknown>>) ?? [];
            for (const m of msgs) {
                const c = String(m["content"] ?? "");
                extractSkillEvents(c, nodeName, events);
            }

            // Emit user-visible tokens only for the supervisor's final
            // response / synthesis.  Supervisor routing messages (e.g.
            // "[Supervisor] Parallel dispatch: ...") must not be streamed.
            const finalResp =
                (partialObj["final_response"] as string) ||
                (partialObj["finalResponse"] as string) ||
                null;
            if (finalResp) {
                pushTokenDelta(finalResp, state, events);
            }
            continue;
        }

        if (nodeName.endsWith("_agent")) {
            const agentFromNode = nodeName.replace(/_agent$/, "");

            if (!state.startedAgents.has(agentFromNode)) {
                state.startedAgents.add(agentFromNode);
                events.push(createStatusEvent(agentFromNode, "started"));
            }

            const msgs = (partialObj["messages"] as Array<Record<string, unknown>>) ?? [];
            for (const m of msgs) {
                const c = String(m["content"] ?? "");
                extractSkillEvents(c, agentFromNode, events);

                const am = c.match(AGENT_PREFIX_RE);
                if (am) {
                    const agentName = am[1]!.toLowerCase();
                    state.agentsUsed.add(agentName);
                    if (!state.startedAgents.has(agentName)) {
                        state.startedAgents.add(agentName);
                        events.push(createStatusEvent(agentName, "started"));
                    }
                    const fullBody = c.replace(AGENT_PREFIX_RE, "").trim();
                    if (fullBody.length > 0 && !(agentName in state.agentResults)) {
                        const preview = fullBody.slice(0, 200) + (fullBody.length > 200 ? "…" : "");
                        events.push(createStatusEvent(agentName, "done", preview));
                        state.agentResults[agentName] = fullBody;
                    }
                }
            }
            continue;
        }

        // Other nodes (guardrails, input/output nodes, mini agents) do not
        // produce user-visible tokens in this stream.
    }

    return events;
}

function extractSkillEvents(
    content: string,
    agentName: string,
    events: StreamEvent[],
): void {
    const sm =
        content.match(/Running agent skill '(\w+)'/i) ??
        content.match(/Running agent skill "(\w+)"/i);
    if (sm) {
        events.push(createSkillEvent(agentName, sm[1]!));
    }
}

function pushTokenDelta(content: string, state: StreamProcessingState, events: StreamEvent[]): void {
    if (!content) return;

    // When content replaces (rather than extends) the accumulated response
    // (e.g. synthesis overwrites agent output), reset tracking so the delta
    // is correct.
    if (state.fullResponse && !content.startsWith(state.fullResponse)) {
        state.fullResponse = "";
    }
    if (content === state.fullResponse) return;

    const delta = content.slice(state.fullResponse.length);
    state.fullResponse = content;
    events.push(createChunkEvent(delta));
}
