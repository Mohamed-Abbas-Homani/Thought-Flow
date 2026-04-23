import type { ChartGraph } from "./chart/types";
import { chartToMermaid } from "./chart/mermaid";
import { useSettingsStore } from "../store/settingsStore";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FLOWCHART_SYSTEM_PROMPT = `You are a flowchart generator. The user describes a process, idea, or system.
Respond ONLY with valid Mermaid flowchart syntax — no markdown fences, no explanation, just the Mermaid content.

Format:
graph TD
title: <Short descriptive title>
n1(["Start"]) --> n2["Step Name"]
n2 --> n3{"Decision?"}
n3 -->|Yes| n4["Another Step"]
n3 -->|No| n5["Handle Error"]
n4 --> n6(["End"])
n5 --> n2

Shape guide:
([ "text" ])  = start or end node       (use for first and last nodes)
[ "text" ]    = action / process step
{ "text" }    = decision (branching)
[/ "text" /]  = input / output
{{ "text" }}  = loop / repeat step
[( "text" )]  = data store
(( "text" ))  = event

Edge guide:
-->        normal flow
-->|label| conditional / labeled (use on decision outgoing edges)
-.->       optional / dotted flow
==>        important / emphasis flow

Rules:
- First node must be n1(["Start"]), last node must be nX(["End"])
- Node IDs must be sequential: n1, n2, n3, ...
- CRITICAL: Always wrap node labels in double quotes inside the shapes: n2["My Label"]
- CRITICAL: Every node must be defined with its label in ["brackets"] on its FIRST appearance.
- Decision nodes {"text"} MUST have ≥2 outgoing edges with labels (Yes/No, True/False, etc.)
- Keep node labels concise (3–6 words)
- direction is TD (vertical) unless user asks for horizontal (use LR instead)
- Output ONLY the Mermaid — no other text`;

function buildPatcherPrompt(chart: ChartGraph): string {
  const mermaid = chartToMermaid(chart);
  return `You are a flowchart editor. The user requests changes to an existing flowchart.
Respond ONLY with the complete modified Mermaid — no explanation, no fences.

CURRENT CHART:
${mermaid}

Shape guide:
([ "text" ]) = start/end  |  [ "text" ] = action  |  { "text" } = decision
[/ "text" /] = io  |  {{ "text" }} = loop  |  [( "text" )] = datastore  |  (( "text" )) = event

Rules:
- CRITICAL: Always wrap node labels in double quotes inside the shapes: n2["My Label"]
- Keep all existing nodes unless explicitly asked to remove them
- Preserve existing node IDs; new nodes continue the sequence
- Decision nodes must keep ≥2 labeled outgoing edges
- Output the COMPLETE modified Mermaid, not just the changed lines`;
}

export async function streamLLM(
  messages: LLMMessage[],
  onChunk: (token: string) => void,
  signal?: AbortSignal,
  currentChart?: ChartGraph | null
): Promise<string> {
  const { llmProvider, llmUrl, llmModel, llmApiKey } = useSettingsStore.getState();
  const systemPrompt = currentChart ? buildPatcherPrompt(currentChart) : FLOWCHART_SYSTEM_PROMPT;
  
  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  if (llmProvider === "ollama") {
    return streamOllama(llmUrl, llmModel, allMessages, onChunk, signal);
  } else if (llmProvider === "openai") {
    return streamOpenAI(llmUrl, llmModel, llmApiKey, allMessages, onChunk, signal);
  } else if (llmProvider === "anthropic") {
    return streamAnthropic(llmUrl, llmModel, llmApiKey, allMessages, onChunk, signal);
  }
  
  throw new Error(`Unsupported provider: ${llmProvider}`);
}

async function streamOllama(
  url: string,
  model: string,
  messages: any[],
  onChunk: (token: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0 } }),
    signal,
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const token = parsed.message?.content ?? "";
        if (token) { accumulated += token; onChunk(token); }
        if (parsed.done) return accumulated.trim();
      } catch {}
    }
  }
  return accumulated.trim();
}

async function streamOpenAI(
  url: string,
  model: string,
  apiKey: string,
  messages: any[],
  onChunk: (token: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = (url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0 }),
    signal,
  });

  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const token = parsed.choices?.[0]?.delta?.content ?? "";
          if (token) { accumulated += token; onChunk(token); }
        } catch {}
      }
    }
  }
  return accumulated.trim();
}

async function streamAnthropic(
  url: string,
  model: string,
  apiKey: string,
  messages: any[],
  onChunk: (token: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = (url || "https://api.anthropic.com/v1").replace(/\/$/, "");
  // Anthropic messages API requires system as a separate field
  const system = messages.find(m => m.role === "system")?.content;
  const userMessages = messages.filter(m => m.role !== "system");

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "dangerously-allow-browser": "true"
    },
    body: JSON.stringify({
      model,
      system,
      messages: userMessages,
      max_tokens: 4096,
      stream: true,
      temperature: 0
    }),
    signal,
  });

  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            const token = parsed.delta.text;
            accumulated += token;
            onChunk(token);
          }
        } catch {}
      }
    }
  }
  return accumulated.trim();
}
