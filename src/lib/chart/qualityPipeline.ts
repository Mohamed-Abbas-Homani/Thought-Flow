import type { ChartGraph } from "./types";
import { chartToMermaid, mermaidToChart } from "./mermaid";
import { validateAndFix } from "./validate";
import { buildPatcherPrompt, completeLLM, FLOWCHART_SYSTEM_PROMPT, type LLMMessage } from "../llm";

export interface QualityPipelineInput {
  history: LLMMessage[];
  userRequest: string;
  currentChart?: ChartGraph | null;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onIntermediateChart?: (chart: ChartGraph, stage: "generation" | "validation" | "enhancer" | "finalize") => void;
  onStageStart?: (stage: "generation" | "validation" | "enhancer") => void;
  onStreamChunk?: (token: string, stage: "generation" | "validation" | "enhancer") => void;
}

export interface QualityPipelineResult {
  chart: ChartGraph;
  mermaid: string;
  report: string;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:mermaid|json)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function stageError(stage: string, message: string, raw?: string): Error {
  const preview = raw ? ` Returned: "${previewText(raw)}"` : "";
  return new Error(`[${stage}] ${message}${preview}`);
}

function sanitizeMermaidSyntax(text: string): string {
  let raw = stripFence(text);

  // Fix a common malformed labeled-edge pattern: -->|label|>n2
  raw = raw.replace(/\|([^|\n]+)\|\s*>/g, "|$1| ");

  // Ensure header lines are isolated.
  raw = raw.replace(/\b(graph\s+(?:TD|TB|LR|RL))\s+/i, "$1\n");
  raw = raw.replace(/\s+(title:\s*[^\n]+)\s+/i, "\n$1\n");

  // Split statements when the model emits multiple Mermaid statements on one line.
  raw = raw.replace(/([)\]"}])( +)([A-Za-z_][\w]*\s*(?:-->|-\.->|==>|[([{>]))/g, "$1\n$3");

  // Split after standalone ids that end one edge and start the next statement.
  raw = raw.replace(/([A-Za-z_][\w]*)( +)([A-Za-z_][\w]*\s*(?:-->|-\.->|==>|[([{>]))/g, "$1\n$3");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function extractMermaid(text: string, stage: string): string {
  const raw = sanitizeMermaidSyntax(text);
  const graphIndex = raw.search(/graph\s+(TD|TB|LR|RL)/);
  if (graphIndex === -1) {
    throw stageError(stage, "LLM did not return Mermaid graph syntax.", text);
  }
  return raw.slice(graphIndex).trim();
}

function formatCurrentChart(currentChart?: ChartGraph | null): string {
  return currentChart ? `\nCURRENT CHART:\n${chartToMermaid(currentChart)}` : "";
}

async function runStage(
  input: QualityPipelineInput,
  stage: "generation" | "validation" | "enhancer",
  progress: string,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  input.onProgress?.(progress);
  input.onStageStart?.(stage);
  assertNotAborted(input.signal);
  const onChunk = input.onStreamChunk ? (token: string) => input.onStreamChunk!(token, stage) : undefined;
  const raw = await completeLLM(systemPrompt, [{ role: "user", content: userContent }], input.signal, onChunk);
  return extractMermaid(raw, stage);
}

function buildDraftPrompt(currentChart?: ChartGraph | null): string {
  return currentChart ? buildPatcherPrompt(currentChart) : FLOWCHART_SYSTEM_PROMPT;
}

function buildValidationPrompt(): string {
  return `You are a flowchart validator and rewriter.
Respond ONLY with the complete corrected Mermaid — no explanation, no fences.

Your job is to rewrite the full chart so it:
- matches the user's requirements exactly
- contains no hallucinated or unsupported business steps
- contains no duplicate or semantically repeated nodes
- has coherent progression and complete branching
- preserves valid parts of the draft where possible

Use the same Mermaid style and constraints as this generator:

${FLOWCHART_SYSTEM_PROMPT}

Additional validation rules:
- Remove duplicate nodes that mean the same thing
- Remove unsupported or hallucinated steps
- Keep only the process actually implied by the user request
- If the draft is partially correct, repair it instead of inventing a new unrelated chart`;
}

function buildEnhancerPrompt(): string {
  return `You are a flowchart enhancer focused on shapes and edge semantics.
Respond ONLY with the complete improved Mermaid — no explanation, no fences.

Your job is to rewrite the validated chart while preserving its process logic.
Improve:
- node shapes for start/end, decisions, input/output, datastore, loop, event
- edge labels for decision branches
- dotted/thick edges only when clearly meaningful

Use the same Mermaid style and constraints as this generator:

${FLOWCHART_SYSTEM_PROMPT}

Shape and edge guide:

- Start node:
  - Use the terminal/rounded start-end shape for the true beginning of the process.
  - Use exactly one global start node unless the user explicitly asks for multiple entry points.
  - The label should be a real business start such as "Request received" or "User opens app", not just "Start" unless the request is generic.

- End node:
  - Use the terminal/rounded start-end shape for true completion, exit, rejection, cancellation, or terminal failure.
  - Use end nodes only for outcomes that really stop that path.
  - Prefer one main successful end, but multiple end nodes are acceptable for meaningfully different terminal outcomes.

- Process step:
  - Use the standard rectangle for normal actions, transformations, computations, service calls, handoffs, approvals, reviews, and internal work steps.
  - This should be the default shape when no more specific semantic shape applies.

- Decision:
  - Use the diamond only when the step is a real branching question, rule check, validation gate, eligibility test, or condition.
  - Decision labels should be phrased as a question or conditional check.
  - Decision nodes should usually have at least two outgoing branches.
  - Prefer labeled outgoing edges such as "Yes/No", "Valid/Invalid", "Approved/Rejected", "Found/Not Found".
  - Do not use a decision node for a simple action or status update.

- Input/Output:
  - Use the input/output parallelogram when the step represents user input, file input, imported data, API response payload, report output, notification output, or presented results.
  - Use this shape when data crosses the system boundary or is explicitly entered/read/displayed/exported.
  - Do not use it for normal internal processing.

- Data store / persistent data:
  - Use the datastore/database shape when the step clearly represents storing, reading, querying, updating, or persisting data in a database, repository, ledger, cache, or external record system.
  - Use it for the data location or persistence interaction, not for general processing.

- Subprocess / reusable routine:
  - Use the subprocess shape when the node represents a meaningful nested routine, reusable workflow, encapsulated procedure, or external workflow that is treated as one step in this diagram.
  - Do not overuse subprocesses for ordinary single actions.

- Event / trigger:
  - Use a distinct event-like shape only when the node truly represents an external event, message, signal, timeout, webhook, timer, or state transition trigger.
  - Do not turn ordinary process steps into events.

- Loop / retry / rework:
  - Represent loops primarily through edges returning to earlier nodes.
  - Use a special loop-oriented node shape only if the loop/retry itself is explicitly a named concept in the workflow.
  - Avoid decorative loop nodes when the loop is already obvious from the decision branch.

- Arrow / normal edge:
  - Use a standard solid arrow for the normal sequence of flow from one step to the next.
  - This should be the default edge type.

- Labeled edge:
  - Use labels mainly for decision outcomes or branches whose meaning would otherwise be unclear.
  - Keep labels short and semantic.
  - Avoid labeling every edge.

- Dotted edge:
  - Use a dotted arrow only when the relation is optional, asynchronous, conditional side-path, non-blocking notification, or soft dependency.
  - Do not use dotted edges for the main happy-path sequence.

- Thick edge:
  - Use a thick arrow only when you need to emphasize a major transition, committed handoff, or especially important control flow and the distinction is genuinely useful.
  - Use sparingly.

- General semantic rules:
  - Prefer the simplest correct shape.
  - If unsure, use a process rectangle rather than an exotic shape.
  - Shapes must reflect meaning, not decoration.
  - Keep the validated structure, ordering, and branching intent unless a small semantic rewrite is necessary to fix shape misuse.
  - Preserve node labels unless a small wording cleanup improves clarity.
  - Do not add new business steps just to justify special shapes.
  - Do not split one concept into multiple nodes with nearly identical meaning.

Additional enhancement rules:
- Preserve the validated business logic
- Do not add hallucinated business steps
- Do not split one step into duplicate-equivalent nodes
- Do not reintroduce duplicates
- Prefer better semantics over extra complexity`;
}

function finalizeChart(mermaid: string, userRequest: string): { chart: ChartGraph; mermaid: string; issues: string[] } {
  try {
    const sanitized = sanitizeMermaidSyntax(mermaid);
    const parsed = mermaidToChart(sanitized);
    const { fixed, issues } = validateAndFix(parsed);
    const finalMermaid = chartToMermaid(fixed);
    const reparsed = mermaidToChart(finalMermaid);
    return { chart: reparsed, mermaid: finalMermaid, issues };
  } catch (err) {
    throw stageError("finalize", `Unable to parse/finalize chart for request "${userRequest}". ${err instanceof Error ? err.message : String(err)}`);
  }
}

function logStageOutput(stage: "generation" | "validation" | "enhancer" | "finalize", mermaid: string, chart: ChartGraph) {
  console.log(
    `[quality:${stage}] ${chart.nodes.length} nodes, ${chart.edges.length} edges\n` +
    `${previewText(mermaid)}`
  );
}

export async function generateQualityChart(input: QualityPipelineInput): Promise<QualityPipelineResult> {
  assertNotAborted(input.signal);

  const current = formatCurrentChart(input.currentChart);
  input.onProgress?.("🤔 Thinking...");

  const draft = await runStage(
    input,
    "generation",
    "🛠️ Generating...",
    buildDraftPrompt(input.currentChart),
    `User request:
${input.userRequest}${current}`
  );
  const draftChart = finalizeChart(draft, input.userRequest).chart;
  logStageOutput("generation", draft, draftChart);
  input.onIntermediateChart?.(draftChart, "generation");

  const validated = await runStage(
    input,
    "validation",
    "✅ Validating...",
    buildValidationPrompt(),
    `User request:
${input.userRequest}

Draft chart:
${draft}`
  );
  const validatedChart = finalizeChart(validated, input.userRequest).chart;
  logStageOutput("validation", validated, validatedChart);
  input.onIntermediateChart?.(validatedChart, "validation");

  const enhanced = await runStage(
    input,
    "enhancer",
    "✨ Enhancing...",
    buildEnhancerPrompt(),
    `User request:
${input.userRequest}

Validated chart:
${validated}`
  );
  const enhancedChart = finalizeChart(enhanced, input.userRequest).chart;
  logStageOutput("enhancer", enhanced, enhancedChart);
  input.onIntermediateChart?.(enhancedChart, "enhancer");

  input.onProgress?.("🏁 Finalizing...");
  const final = finalizeChart(enhanced, input.userRequest);
  logStageOutput("finalize", final.mermaid, final.chart);
  input.onIntermediateChart?.(final.chart, "finalize");

  return {
    chart: final.chart,
    mermaid: final.mermaid,
    report: `Quality mode completed: draft -> validation -> enhancer -> finalize (${final.chart.nodes.length} nodes, ${final.chart.edges.length} edges${final.issues.length ? `, ${final.issues.length} auto-fix notes` : ""}).`,
  };
}
