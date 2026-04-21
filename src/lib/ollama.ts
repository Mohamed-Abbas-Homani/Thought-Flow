export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FLOWCHART_SYSTEM_PROMPT = `You are a flowchart generator. The user describes a process, idea, or system.
You must respond ONLY with a valid JSON object — no markdown, no code block, no explanation, just raw JSON.

Use this exact schema:
{
  "meta": { "type": "flowchart", "title": "<short descriptive title>", "direction": "vertical", "version": "1.0" },
  "nodes": [
    { "id": "n1", "text": "...", "type": "start",  "shape": "stadium",       "styleClass": null, "metadata": {} },
    { "id": "n2", "text": "...", "type": "action",  "shape": "rounded-rect",  "styleClass": null, "metadata": {} },
    { "id": "n3", "text": "...", "type": "decision","shape": "diamond",       "styleClass": null, "metadata": {} },
    { "id": "n4", "text": "...", "type": "end",     "shape": "stadium",       "styleClass": null, "metadata": {} }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "type": "sequential", "label": "",    "style": "solid", "metadata": {} },
    { "from": "n3", "to": "n4", "type": "conditional", "label": "Yes", "style": "solid", "metadata": {} }
  ],
  "styles": { "classes": {}, "nodeStyles": {}, "edgeStyles": {} },
  "extensions": {}
}

Valid node types: start, end, decision, action, io, loop, subprocess, datastore, event, milestone, status
Valid shapes: rounded-rect, rect, diamond, parallelogram, hexagon, subroutine, cylinder, double-circle, flag, stadium
Valid edge types: sequential, conditional, merge, loop, jump, parallel
Valid edge styles: solid, dotted, thick, open

Rules:
- Always start with a "start" node and end with an "end" node
- Use "decision" nodes for branching; label the outgoing edges (Yes/No, True/False, etc.)
- Keep node text concise (3–6 words max)
- Use unique sequential IDs: n1, n2, n3, ...
- direction should be "vertical" unless the user asks for horizontal`;

export async function streamOllama(
  messages: OllamaMessage[],
  onChunk: (token: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const payload = {
    model: "llama3.1:8b",
    messages: [
      { role: "system", content: FLOWCHART_SYSTEM_PROMPT },
      ...messages,
    ],
    stream: true,
  };

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

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const token  = parsed.message?.content ?? "";
        if (token) {
          accumulated += token;
          onChunk(token);
        }
        if (parsed.done) break;
      } catch {
        // ignore malformed lines
      }
    }
  }

  return accumulated;
}
