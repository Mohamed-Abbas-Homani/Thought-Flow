import type { ChartGraph } from "./chart/types";
import { chartToMermaid } from "./chart/mermaid";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FLOWCHART_SYSTEM_PROMPT = `You are a flowchart generator. The user describes a process, idea, or system.
Respond ONLY with valid Mermaid flowchart syntax — no markdown fences, no explanation, just the Mermaid content.

Format:
graph TD
title: <Short descriptive title>
n1([Start]) --> n2[Step Name]
n2 --> n3{Decision?}
n3 -->|Yes| n4[Another Step]
n3 -->|No| n5[Handle Error]
n4 --> n6([End])
n5 --> n2

Shape guide:
([text])  = start or end node       (use for first and last nodes)
[text]    = action / process step
{text}    = decision (branching)
[/text/]  = input / output
{{text}}  = loop / repeat step
[(text)]  = data store
((text))  = event

Edge guide:
-->        normal flow
-->|label| conditional / labeled (use on decision outgoing edges)
-.->       optional / dotted flow
==>        important / emphasis flow

Rules:
- First node must be n1([Start]), last node must be nX([End])
- Node IDs must be sequential: n1, n2, n3, ...
- CRITICAL: Every node must be defined with its label in [brackets] on its FIRST appearance.
  If a node appears as an edge target for the first time, include its label: n3 -->|Yes| n7[My Label]
  A bare ID like "n7" with no brackets is only allowed if that node was already defined earlier.
- Decision nodes {text} MUST have ≥2 outgoing edges with labels (Yes/No, True/False, etc.)
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
([text]) = start/end  |  [text] = action  |  {text} = decision
[/text/] = io  |  {{text}} = loop  |  [(text)] = datastore  |  ((text)) = event

Rules:
- Keep all existing nodes unless explicitly asked to remove them
- Preserve existing node IDs; new nodes continue the sequence
- Decision nodes must keep ≥2 labeled outgoing edges
- Output the COMPLETE modified Mermaid, not just the changed lines`;
}

export async function streamOllama(
  messages: OllamaMessage[],
  onChunk: (token: string) => void,
  signal?: AbortSignal,
  currentChart?: ChartGraph | null
): Promise<string> {
  const systemPrompt = currentChart ? buildPatcherPrompt(currentChart) : FLOWCHART_SYSTEM_PROMPT;
  console.log(`[ollama] mode=${currentChart ? "patcher" : "generator"}, messages=${messages.length}`);

  const payload = {
    model: "llama3.1:8b",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    stream: true,
    options: {
      temperature: 0,
      top_p: 1,
      top_k: 0,
    },
  };

  console.log("[ollama] input messages:", payload.messages);

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader  = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const token  = parsed.message?.content ?? "";
        if (token) {
          accumulated += token;
          onChunk(token);
        }
        if (parsed.done) {
          done = true;
          break;
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim()) as { message?: { content?: string }; done?: boolean };
      const token  = parsed.message?.content ?? "";
      if (token) { accumulated += token; onChunk(token); }
    } catch {
      // ignore
    }
  }

  const result = accumulated.trim();
  console.log("[ollama] full response:", result);
  return result;
}
