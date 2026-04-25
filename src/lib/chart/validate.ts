import type { ChartGraph } from "./types";

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  fixed: ChartGraph;
}

export function validateAndFix(chart: ChartGraph): ValidationResult {
  const issues: string[] = [];
  let nodes = [...chart.nodes];
  let edges = [...chart.edges];

  const nodeIds = () => new Set(nodes.map((n) => n.id));

  // 1. Remove edges referencing non-existent nodes
  edges = edges.filter((e) => {
    const ids = nodeIds();
    if (!ids.has(e.from) || !ids.has(e.to)) {
      issues.push(
        `[validate] removed broken edge ${e.from}→${e.to} (node not found)`,
      );
      return false;
    }
    return true;
  });

  // 2. Remove duplicate edges (same from+to)
  const edgeSeen = new Set<string>();
  edges = edges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (edgeSeen.has(key)) {
      issues.push(`[validate] removed duplicate edge ${e.from}→${e.to}`);
      return false;
    }
    edgeSeen.add(key);
    return true;
  });

  // 3. Fix duplicate node IDs (keep first, suffix later ones)
  const seenIds = new Map<string, number>();
  nodes = nodes.map((n) => {
    const count = seenIds.get(n.id) ?? 0;
    seenIds.set(n.id, count + 1);
    if (count > 0) {
      const newId = `${n.id}_${count + 1}`;
      issues.push(`[validate] renamed duplicate node ${n.id} → ${newId}`);
      // Update edges referencing this exact duplicate (only the Nth occurrence)
      // This is approximate — duplicate IDs are rare and caused by model error
      return { ...n, id: newId };
    }
    return n;
  });

  // 4. Ensure a start node exists
  const startNodes = nodes.filter((n) => n.type === "start");
  if (startNodes.length === 0 && nodes.length > 0) {
    // Promote node with no incoming edges, or simply the first node
    const incomingIds = new Set(edges.map((e) => e.to));
    const candidate = nodes.find((n) => !incomingIds.has(n.id)) ?? nodes[0];
    nodes = nodes.map((n) =>
      n.id === candidate.id ? { ...n, type: "start", shape: "stadium" } : n,
    );
    issues.push(
      `[validate] promoted ${candidate.id} "${candidate.text}" to start node`,
    );
  }

  // 5. Ensure an end node exists
  const endNodes = nodes.filter((n) => n.type === "end");
  if (endNodes.length === 0 && nodes.length > 0) {
    // Promote node with no outgoing edges, or the last node
    const outgoingIds = new Set(edges.map((e) => e.from));
    const candidate =
      [...nodes]
        .reverse()
        .find((n) => !outgoingIds.has(n.id) && n.type !== "start") ??
      nodes[nodes.length - 1];
    nodes = nodes.map((n) =>
      n.id === candidate.id ? { ...n, type: "end", shape: "stadium" } : n,
    );
    issues.push(
      `[validate] promoted ${candidate.id} "${candidate.text}" to end node`,
    );
  }

  // 6. Decision nodes must have ≥2 outgoing edges
  const outgoingCount = new Map<string, number>();
  for (const e of edges) {
    outgoingCount.set(e.from, (outgoingCount.get(e.from) ?? 0) + 1);
  }
  for (const n of nodes) {
    if (n.type === "decision" && (outgoingCount.get(n.id) ?? 0) < 2) {
      issues.push(
        `[validate] decision node ${n.id} "${n.text}" has <2 outgoing edges`,
      );
      // Don't auto-fix edges (we don't know where to connect) — just log
    }
  }

  // 7. Warn about orphaned nodes (no edges at all)
  const connectedIds = new Set([
    ...edges.map((e) => e.from),
    ...edges.map((e) => e.to),
  ]);
  for (const n of nodes) {
    if (!connectedIds.has(n.id) && n.type !== "start" && n.type !== "end") {
      issues.push(`[validate] orphaned node ${n.id} "${n.text}" has no edges`);
    }
  }

  if (issues.length > 0) {
    console.log(issues.join("\n"));
  }

  return {
    valid: issues.length === 0,
    issues,
    fixed: { ...chart, nodes, edges },
  };
}
