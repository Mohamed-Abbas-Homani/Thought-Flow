import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { ChartGraph } from "./chart/types";
import { chartToMermaid } from "./chart/mermaid";
import { useSettingsStore } from "../store/settingsStore";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const FLOWCHART_SYSTEM_PROMPT = `You are a flowchart generator. The user describes a process, idea, or system.
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
- Decision nodes {"text"} MUST have ≥2 outgoing edges with labels
- Keep node labels concise (3–6 words)
- direction is TD (vertical) unless user asks for horizontal (use LR instead)
- Output ONLY the Mermaid — no other text`;

export function buildPatcherPrompt(chart: ChartGraph): string {
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

export const ASSIST_SYSTEM_PROMPT = `You are an AI assistant for a flowchart tool. The user is typing a prompt.
Your task is to provide:
1. The current Mermaid flowchart code based on what they have written so far.
2. A short natural-language text completion that continues exactly what the user is typing.
3. The ADDITIONAL Mermaid code (nodes and edges) for that suggestion.

FLOWCHART RULES:
- The mermaid field must begin with graph TD, then a title line: title: <Short descriptive title>.
- Always generate a concise chart title that names the process being described.
- First node must be n1(["Start"])
- Node IDs must be sequential: n1, n2, n3, ...
- Wrap node labels in double quotes: n2["Label"]
- Every node must be defined with its label in shape brackets on its FIRST appearance.
- Decision nodes {"text"} MUST have ≥2 outgoing labeled edges.
- Keep labels concise.

SHAPE GUIDE:
([ "text" ]) = start/end | [ "text" ] = action | { "text" } = decision
[/ "text" /] = io | {{ "text" }} = loop | [( "text" )] = datastore

Respond ONLY in JSON format:
{
  "mermaid": "graph TD\\ntitle: Customer Request Process\\nn1([\"Start\"]) --> n2[\"Step\"]",
  "suggestionText": " then validates the request and sends the result to the customer.",
  "suggestionMermaid": "n2 --> n3[\"Next Step\"]"
}

IMPORTANT:
- Use \\n for newlines in mermaid.
- Return ONLY JSON.
- suggestionText is text for the prompt textarea, not a node name, ID, Mermaid fragment, label list, or title.
- suggestionText must be only the suffix to append after the user's current text. Include a leading space only when natural.
- suggestionText should describe the next process action in plain language, usually 5-18 words.
- suggestionMermaid nodes should link to existing nodes.`;

export const REFINE_SYSTEM_PROMPT = `You are a flowchart validator and enhancer.
Analyze the provided Mermaid code and enhance it by:
1. Removing duplicate nodes or edges.
2. Ensuring all nodes are connected (no orphans).
3. Choosing the best shapes based on node content (decision nodes for questions, stadium for start/stop, etc.).
4. Fixing IDs to be perfectly sequential (n1, n2, n3...).
5. Ensuring valid Mermaid syntax.
6. CRITICAL: DO NOT add new business steps or nodes. Only refine what is already there.

SHAPE AND EDGE SEMANTICS:
- Start Node: Use ([ "text" ]) for initial trigger/received request. One global start preferred.
- End Node: Use ([ "text" ]) for completion, cancellation, or terminal failure.
- Process: Use [ "text" ] for standard internal actions, work, and generic steps.
- Decision: Use { "text" } for branching logic. Phrased as a question. MUST have labeled outgoing edges.
- Input/Output: Use [/ "text" /] for user input, displaying reports, API payloads, or exported data.
- Data Store: Use [( "text" )] for reading/writing to a database, ledger, or persistent file system.
- Subprocess: Use [[ "text" ]] for complex nested routines or standard reusable procedures.
- Edges: Use standard --> for main flow, -.-> for async/optional side-paths, and ==> for critical paths.

Respond ONLY with the enhanced Mermaid code — no explanation, no fences.`;

export async function streamLLM(
  messages: LLMMessage[],
  onChunk: (token: string) => void,
  signal?: AbortSignal,
  currentChart?: ChartGraph | null,
): Promise<string> {
  const { llmProvider, llmUrl, llmModel, llmApiKey, anthropicMaxTokens } =
    useSettingsStore.getState();
  const systemPrompt = currentChart
    ? buildPatcherPrompt(currentChart)
    : FLOWCHART_SYSTEM_PROMPT;

  const allMessages = [{ role: "system", content: systemPrompt }, ...messages];

  if (llmProvider === "ollama") {
    return streamOllama(llmUrl, llmModel, allMessages, onChunk, signal);
  } else if (llmProvider === "openai") {
    return streamOpenAI(
      llmUrl,
      llmModel,
      llmApiKey,
      allMessages,
      onChunk,
      signal,
    );
  } else if (llmProvider === "anthropic") {
    return streamAnthropic(
      llmUrl,
      llmModel,
      llmApiKey,
      anthropicMaxTokens,
      allMessages,
      onChunk,
      signal,
    );
  }

  throw new Error(`Unsupported provider: ${llmProvider}`);
}

export async function completeLLM(
  systemPrompt: string,
  messages: LLMMessage[],
  signal?: AbortSignal,
  onChunk?: (token: string) => void,
): Promise<string> {
  const allMessages = [{ role: "system", content: systemPrompt }, ...messages];

  const chunks: string[] = [];
  const collect = (token: string) => {
    chunks.push(token);
    onChunk?.(token);
  };
  const { llmProvider, llmUrl, llmModel, llmApiKey, anthropicMaxTokens } =
    useSettingsStore.getState();

  if (llmProvider === "ollama") {
    await streamOllama(llmUrl, llmModel, allMessages, collect, signal);
  } else if (llmProvider === "openai") {
    await streamOpenAI(
      llmUrl,
      llmModel,
      llmApiKey,
      allMessages,
      collect,
      signal,
    );
  } else if (llmProvider === "anthropic") {
    await streamAnthropic(
      llmUrl,
      llmModel,
      llmApiKey,
      anthropicMaxTokens,
      allMessages,
      collect,
      signal,
    );
  } else {
    throw new Error(`Unsupported provider: ${llmProvider}`);
  }

  return chunks.join("").trim();
}

export async function suggestLLM(
  prompt: string,
  history: LLMMessage[],
  signal?: AbortSignal,
): Promise<{
  mermaid: string;
  suggestionText: string;
  suggestionMermaid: string;
} | null> {
  const messages: LLMMessage[] = [
    ...history,
    { role: "user", content: prompt },
  ];

  try {
    const raw = await completeLLM(ASSIST_SYSTEM_PROMPT, messages, signal);
    // Handle cases where LLM includes markdown fences despite the prompt
    const clean = raw
      .replace(/```(?:json)?/g, "")
      .replace(/```/g, "")
      .trim();
    const jsonText = clean.match(/\{[\s\S]*\}/)?.[0] ?? clean;
    const parsed = JSON.parse(jsonText);

    return {
      mermaid: typeof parsed.mermaid === "string" ? parsed.mermaid : "",
      suggestionText: cleanAssistSuggestionText(
        typeof parsed.suggestionText === "string" ? parsed.suggestionText : "",
      ),
      suggestionMermaid:
        typeof parsed.suggestionMermaid === "string"
          ? parsed.suggestionMermaid
          : "",
    };
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.warn("[assist] failed to parse suggestion:", err);
    }
    return null;
  }
}

function cleanAssistSuggestionText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\bgraph\s+(?:TD|LR|BT|RL)\b[\s\S]*$/i, "")
    .replace(/\bn\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trimEnd();
}

export async function refineLLM(
  mermaid: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: LLMMessage[] = [{ role: "user", content: mermaid }];
  const raw = await completeLLM(REFINE_SYSTEM_PROMPT, messages, signal);
  return raw
    .replace(/```(?:mermaid)?/g, "")
    .replace(/```/g, "")
    .trim();
}

async function streamOllama(
  url: string,
  model: string,
  messages: any[],
  onChunk: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: 0 },
    }),
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
        if (token) {
          accumulated += token;
          onChunk(token);
        }
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
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = (url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await tauriFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
          if (token) {
            accumulated += token;
            onChunk(token);
          }
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
  maxTokens: number | undefined,
  messages: any[],
  onChunk: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = (url || "https://api.anthropic.com/v1").replace(/\/$/, "");
  // Anthropic messages API requires system as a separate field
  const system = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role !== "system");

  const cleanApiKey = apiKey.trim();
  const safeMaxTokens =
    Number.isFinite(maxTokens) && (maxTokens ?? 0) > 0
      ? Math.floor(maxTokens ?? 1024)
      : 1024;
  const body = {
    model,
    system,
    messages: userMessages,
    stream: true,
    max_tokens: safeMaxTokens,
    temperature: 0,
  };

  const requestHeaders = {
    "content-type": "application/json",
    "x-api-key": cleanApiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  console.log("[anthropic] url:", `${baseUrl}/messages`);
  console.log("[anthropic] headers:", {
    ...requestHeaders,
    "x-api-key": cleanApiKey
      ? `${cleanApiKey.slice(0, 8)}...${cleanApiKey.slice(-4)} (len=${cleanApiKey.length})`
      : "(empty)",
  });
  console.log("[anthropic] body:", JSON.stringify(body, null, 2));

  const response = await tauriFetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal,
  });

  console.log(
    "[anthropic] response status:",
    response.status,
    response.statusText,
  );
  if (!response.ok) {
    const errBody = await response.text();
    console.error("[anthropic] error body:", errBody);
    throw new Error(`Anthropic error: ${response.status} — ${errBody}`);
  }

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
