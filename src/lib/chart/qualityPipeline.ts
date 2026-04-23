import type { ChartEdge, ChartGraph, ChartMeta, ChartNode } from "./types";
import { chartToMermaid, mermaidToChart } from "./mermaid";
import { validateAndFix } from "./validate";
import { completeLLM, type LLMMessage } from "../llm";

interface QualitySectionPlan {
  id: string;
  title: string;
  goal: string;
  dependsOn?: string[];
  entryLabel?: string;
  exitLabel?: string;
  requiredDecisions?: string[];
  shapeNotes?: string[];
}

interface QualityPlan {
  title: string;
  direction: "vertical" | "horizontal";
  sections: QualitySectionPlan[];
}

interface ValidationAudit {
  valid: boolean;
  issues: string[];
  summary?: string;
}

export interface QualityPipelineInput {
  history: LLMMessage[];
  userRequest: string;
  currentChart?: ChartGraph | null;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface QualityPipelineResult {
  chart: ChartGraph;
  mermaid: string;
  report: string;
}

const SHAPE_GUIDE = `Shape guide:
([ "text" ]) = start/end only
["text"] = action/process
{"text"} = decision with 2+ labeled outgoing edges
[/ "text" /] = input/output
{{"text"}} = loop/retry
[("text")] = data store
(("text")) = event`;

const ENABLE_QUALITY_VALIDATION_REPAIR = false;

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function stripFence(text: string): string {
  const jsonFence = text.match(/```(?:json|mermaid)?\s*\n([\s\S]*?)```/);
  return (jsonFence ? jsonFence[1] : text).trim();
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function stageError(stage: string, message: string, raw?: string): Error {
  const preview = raw ? ` Returned: "${previewText(raw)}"` : "";
  return new Error(`[${stage}] ${message}${preview}`);
}

function extractJson<T>(text: string, stage = "JSON parse"): T {
  const raw = stripFence(text);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    }
    throw stageError(stage, "LLM did not return valid JSON.", text);
  }
}

function extractMermaid(text: string, stage = "Mermaid parse"): string {
  const raw = stripFence(text);
  const graphIndex = raw.search(/graph\s+(TD|TB|LR|RL)/);
  if (graphIndex === -1) {
    throw stageError(stage, "LLM did not return Mermaid graph syntax.", text);
  }
  return raw.slice(graphIndex).trim();
}

function safePlan(plan: Partial<QualityPlan>, request: string): QualityPlan {
  const sections = Array.isArray(plan.sections) && plan.sections.length > 0
    ? plan.sections.slice(0, 8)
    : [{
        id: "s1",
        title: "Main Flow",
        goal: request,
      }];

  return {
    title: typeof plan.title === "string" && plan.title.trim() ? plan.title.trim() : "Quality Flowchart",
    direction: plan.direction === "horizontal" ? "horizontal" : "vertical",
    sections: sections.map((section, index) => ({
      id: `s${index + 1}`,
      title: section.title || `Section ${index + 1}`,
      goal: section.goal || request,
      dependsOn: Array.isArray(section.dependsOn) ? section.dependsOn : index > 0 ? [`s${index}`] : [],
      entryLabel: section.entryLabel || "Entry",
      exitLabel: section.exitLabel || "Exit",
      requiredDecisions: Array.isArray(section.requiredDecisions) ? section.requiredDecisions : [],
      shapeNotes: Array.isArray(section.shapeNotes) ? section.shapeNotes : [],
    })),
  };
}

function summarizeChart(chart: ChartGraph): string {
  const nodes = chart.nodes.map((n) => `${n.id}:${n.text}`).join(", ");
  const edges = chart.edges.map((e) => `${e.from}->${e.to}${e.label ? `(${e.label})` : ""}`).join(", ");
  return `Nodes: ${nodes}\nEdges: ${edges}`;
}

async function planQualityChart(input: QualityPipelineInput): Promise<QualityPlan> {
  input.onProgress?.("Planning...");
  const current = input.currentChart ? `\nCURRENT CHART:\n${chartToMermaid(input.currentChart)}` : "";
  const system = `You are a senior flowchart planner.
Return JSON only. Do not use markdown.
Your entire response must be one JSON object. No prose before or after it.
Plan how to produce a high-quality Mermaid flowchart from the user's request.
For simple requests use 1 section. For large requests use 4-8 sections of about 8-12 nodes each.
Use ids exactly as s1, s2, s3, ...
JSON shape:
{
  "title": "short title",
  "direction": "vertical" | "horizontal",
  "sections": [
    {
      "id": "s1",
      "title": "section title",
      "goal": "what this section must cover",
      "dependsOn": [],
      "entryLabel": "entry meaning",
      "exitLabel": "exit meaning",
      "requiredDecisions": ["decision topics"],
      "shapeNotes": ["shape requirements"]
    }
  ]
}

Example valid response:
{
  "title": "Customer Support Workflow",
  "direction": "vertical",
  "sections": [
    {
      "id": "s1",
      "title": "Request Intake",
      "goal": "Capture the request and classify it",
      "dependsOn": [],
      "entryLabel": "New request",
      "exitLabel": "Classified",
      "requiredDecisions": ["Is information complete?"],
      "shapeNotes": ["Use parallelogram for submitted request input"]
    }
  ]
}`;

  const result = await completeLLM(system, [
    ...input.history,
    { role: "user", content: `Plan this flowchart request:\n${input.userRequest}${current}` },
  ], input.signal);

  let parsed: Partial<QualityPlan>;
  try {
    parsed = extractJson<Partial<QualityPlan>>(result, "planner");
  } catch (err) {
    throw err instanceof Error ? err : stageError("planner", String(err), result);
  }
  const plan = safePlan(parsed, input.userRequest);
  input.onProgress?.(`Planned ${plan.sections.length} section${plan.sections.length === 1 ? "" : "s"}...`);
  return plan;
}

async function generateSection(
  input: QualityPipelineInput,
  plan: QualityPlan,
  section: QualitySectionPlan,
  index: number,
  completedSummaries: string[]
): Promise<string> {
  input.onProgress?.(`Generating section ${index + 1}/${plan.sections.length}...`);
  const system = `You are a precise Mermaid flowchart section generator.
Return Mermaid only. No fences. No explanation.
Your first line must be exactly: graph TD or graph LR.
Generate only this section as a fragment graph using namespaced IDs: ${section.id}_n1, ${section.id}_n2, ...
Do not create global Start or End nodes unless the section goal explicitly requires them.
Every node must define its label on first appearance.
Decision nodes must have 2+ labeled outgoing edges.
Do not include markdown fences, bullets, prose, JSON, or comments.
Use quoted labels in every node definition.
${SHAPE_GUIDE}

Example valid section response:
graph TD
${section.id}_n1[/"Receive Request"/] --> ${section.id}_n2{"Information Complete?"}
${section.id}_n2 -->|Yes| ${section.id}_n3["Classify Request"]
${section.id}_n2 -->|No| ${section.id}_n4["Ask For Details"]
${section.id}_n4 --> ${section.id}_n1`;

  const raw = await completeLLM(system, [
    { role: "user", content: `Original request:\n${input.userRequest}

Full plan:
${JSON.stringify(plan, null, 2)}

Completed section summaries:
${completedSummaries.join("\n\n") || "None"}

Generate section:
${JSON.stringify(section, null, 2)}` },
  ], input.signal);

  return extractMermaid(raw, `section ${index + 1} generation (${section.id}: ${section.title})`);
}

async function auditMermaid(
  input: QualityPipelineInput,
  stage: string,
  plan: QualityPlan,
  mermaid: string
): Promise<ValidationAudit> {
  input.onProgress?.(`Validating ${stage}...`);
  const system = `You are a strict flowchart QA reviewer.
Return JSON only. Do not use markdown.
Check whether the Mermaid flowchart satisfies the user request, uses appropriate node shapes, has clear edge labels, and decision nodes branch correctly.
JSON shape: { "valid": boolean, "issues": ["specific issue"], "summary": "short summary" }`;

  const result = await completeLLM(system, [
    { role: "user", content: `Original request:\n${input.userRequest}

Plan:
${JSON.stringify(plan, null, 2)}

Stage: ${stage}

Mermaid:
${mermaid}` },
  ], input.signal);

  try {
    const audit = extractJson<Partial<ValidationAudit>>(result, `${stage} audit`);
    return {
      valid: audit.valid === true,
      issues: Array.isArray(audit.issues) ? audit.issues.filter(Boolean) : [],
      summary: audit.summary,
    };
  } catch {
    return { valid: false, issues: ["Validator did not return parseable JSON"] };
  }
}

async function repairMermaid(
  input: QualityPipelineInput,
  stage: string,
  plan: QualityPlan,
  mermaid: string,
  issues: string[]
): Promise<string> {
  input.onProgress?.(`Repairing ${stage}...`);
  const system = `You repair Mermaid flowcharts.
Return complete Mermaid only. No fences. No explanation.
Preserve valid content, fix the listed issues, and keep labels concise.
${SHAPE_GUIDE}`;

  const raw = await completeLLM(system, [
    { role: "user", content: `Original request:\n${input.userRequest}

Plan:
${JSON.stringify(plan, null, 2)}

Issues:
${issues.map((issue) => `- ${issue}`).join("\n")}

Mermaid to repair:
${mermaid}` },
  ], input.signal);

  return extractMermaid(raw, `${stage} repair`);
}

async function generateValidatedSection(
  input: QualityPipelineInput,
  plan: QualityPlan,
  section: QualitySectionPlan,
  index: number,
  completedSummaries: string[]
): Promise<ChartGraph> {
  let mermaid = await generateSection(input, plan, section, index, completedSummaries);
  let best = mermaidToChart(mermaid);

  if (!ENABLE_QUALITY_VALIDATION_REPAIR) {
    return best;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    assertNotAborted(input.signal);
    const deterministic = validateAndFix(mermaidToChart(mermaid));
    best = deterministic.fixed;
    const audit = await auditMermaid(input, `section ${index + 1}`, plan, chartToMermaid(best));
    if (audit.valid && deterministic.issues.length === 0) return best;

    const issues = [...deterministic.issues, ...audit.issues];
    if (attempt === 1 || issues.length === 0) break;
    mermaid = await repairMermaid(input, `section ${index + 1}`, plan, chartToMermaid(best), issues);
  }

  return best;
}

function makeNode(id: string, text: string, type: string, shape: string): ChartNode {
  return { id, text, type, shape, styleClass: null, metadata: {} };
}

function makeEdge(from: string, to: string, label = ""): ChartEdge {
  return {
    from,
    to,
    type: label ? "conditional" : "sequential",
    label,
    style: "solid",
    metadata: {},
  };
}

function sectionEntry(chart: ChartGraph): string | null {
  const incoming = new Set(chart.edges.map((e) => e.to));
  return chart.nodes.find((n) => !incoming.has(n.id))?.id ?? chart.nodes[0]?.id ?? null;
}

function sectionExit(chart: ChartGraph): string | null {
  const outgoing = new Set(chart.edges.map((e) => e.from));
  return [...chart.nodes].reverse().find((n) => !outgoing.has(n.id))?.id ?? chart.nodes[chart.nodes.length - 1]?.id ?? null;
}

function normalizedLabel(text: string): string {
  return text
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeGraph(chart: ChartGraph, title: string): ChartGraph {
  const idMap = new Map<string, string>();
  chart.nodes.forEach((node, index) => idMap.set(node.id, `n${index + 1}`));

  return {
    ...chart,
    meta: { ...chart.meta, title },
    nodes: chart.nodes.map((node, index) => ({ ...node, id: `n${index + 1}` })),
    edges: chart.edges
      .map((edge) => ({
        ...edge,
        from: idMap.get(edge.from) ?? edge.from,
        to: idMap.get(edge.to) ?? edge.to,
      }))
      .filter((edge) => idMap.has(edge.from) || /^n\d+$/.test(edge.from))
      .filter((edge) => idMap.has(edge.to) || /^n\d+$/.test(edge.to)),
  };
}

function assembleGraph(plan: QualityPlan, sections: ChartGraph[]): ChartGraph {
  const meta: ChartMeta = {
    type: "flowchart",
    title: plan.title,
    direction: plan.direction,
    version: "1.0",
  };
  const nodes: ChartNode[] = [makeNode("global_start", "Start", "start", "stadium")];
  const edges: ChartEdge[] = [];
  const entries: Array<string | null> = [];
  const exits: Array<string | null> = [];
  const nodeById = new Map<string, ChartNode>(nodes.map((node) => [node.id, node]));
  const alias = new Map<string, string>();
  const canonical = (id: string) => {
    let current = id;
    while (alias.has(current)) current = alias.get(current)!;
    return current;
  };
  const addEdge = (edge: ChartEdge) => {
    const from = canonical(edge.from);
    const to = canonical(edge.to);
    if (from === to) return;
    edges.push({ ...edge, from, to });
  };

  for (const chart of sections) {
    const sectionNodes = chart.nodes.filter((node) => node.text.toLowerCase() !== "start" && node.text.toLowerCase() !== "end");
    const sectionIds = new Set(sectionNodes.map((node) => node.id));
    const sectionEdges = chart.edges.filter((edge) => sectionIds.has(edge.from) && sectionIds.has(edge.to));
    const entry = sectionEntry({ ...chart, nodes: sectionNodes, edges: sectionEdges });
    const exit = sectionExit({ ...chart, nodes: sectionNodes, edges: sectionEdges });
    const prevExit = exits[exits.length - 1];
    const entryNode = entry ? sectionNodes.find((node) => node.id === entry) : null;
    const prevExitNode = prevExit ? nodeById.get(canonical(prevExit)) : null;

    if (entry && entryNode && prevExitNode && normalizedLabel(entryNode.text) === normalizedLabel(prevExitNode.text)) {
      alias.set(entry, canonical(prevExitNode.id));
      entries.push(canonical(prevExitNode.id));
    } else {
      entries.push(entry);
    }

    for (const node of sectionNodes) {
      if (alias.has(node.id)) continue;
      nodes.push(node);
      nodeById.set(node.id, node);
    }
    for (const edge of sectionEdges) addEdge(edge);
    exits.push(exit ? canonical(exit) : null);
  }

  for (let i = 0; i < sections.length; i++) {
    const entry = entries[i];
    const prevExit = i === 0 ? "global_start" : exits[i - 1];
    if (entry && prevExit && canonical(entry) !== canonical(prevExit)) {
      addEdge(makeEdge(prevExit, entry, i === 0 ? "" : plan.sections[i]?.entryLabel || ""));
    }
  }

  const endNode = makeNode("global_end", "End", "end", "stadium");
  nodes.push(endNode);
  nodeById.set(endNode.id, endNode);
  const lastExit = exits[exits.length - 1];
  if (lastExit) addEdge(makeEdge(lastExit, "global_end"));

  const uniqueEdges = new Map<string, ChartEdge>();
  for (const edge of edges) {
    uniqueEdges.set(`${edge.from}->${edge.to}->${edge.label ?? ""}`, edge);
  }

  return normalizeGraph({
    meta,
    nodes,
    edges: Array.from(uniqueEdges.values()),
    styles: { classes: {}, nodeStyles: {}, edgeStyles: {} },
    extensions: {},
  }, plan.title);
}

export async function generateQualityChart(input: QualityPipelineInput): Promise<QualityPipelineResult> {
  assertNotAborted(input.signal);
  const plan = await planQualityChart(input);
  const sections: ChartGraph[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < plan.sections.length; i++) {
    assertNotAborted(input.signal);
    const chart = await generateValidatedSection(input, plan, plan.sections[i], i, summaries);
    sections.push(chart);
    summaries.push(`${plan.sections[i].id} ${plan.sections[i].title}\n${summarizeChart(chart)}`);
  }

  input.onProgress?.("Assembling final chart...");
  let assembled = ENABLE_QUALITY_VALIDATION_REPAIR
    ? validateAndFix(assembleGraph(plan, sections)).fixed
    : assembleGraph(plan, sections);
  let mermaid = chartToMermaid(assembled);

  if (ENABLE_QUALITY_VALIDATION_REPAIR) {
    const audit = await auditMermaid(input, "final chart", plan, mermaid);
    if (!audit.valid && audit.issues.length > 0) {
      mermaid = await repairMermaid(input, "final chart", plan, mermaid, audit.issues);
      assembled = validateAndFix(mermaidToChart(mermaid)).fixed;
      mermaid = chartToMermaid(normalizeGraph(assembled, plan.title));
      assembled = mermaidToChart(mermaid);
    }
  }

  const final = ENABLE_QUALITY_VALIDATION_REPAIR ? validateAndFix(assembled).fixed : assembled;
  const finalMermaid = chartToMermaid(final);
  return {
    chart: final,
    mermaid: finalMermaid,
    report: `Quality mode completed: ${plan.sections.length} section(s), ${final.nodes.length} node(s), ${final.edges.length} edge(s).`,
  };
}
