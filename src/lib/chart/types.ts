export interface ChartStyle {
  background?: string;
  text?: string;
  border?: string;
  bold?: boolean;
  dashed?: boolean;
}

export interface ChartMeta {
  type: "flowchart"; // extensible union in future
  title: string;
  direction: "horizontal" | "vertical";
  version: string;
}

export interface ChartNode {
  id: string;
  text: string;
  type: string;
  shape: string;
  styleClass?: string | null;
  metadata: Record<string, unknown>;
}

export interface ChartEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
  style: "solid" | "dotted" | "thick" | "open";
  metadata: Record<string, unknown>;
}

export interface ChartGraph {
  meta: ChartMeta;
  nodes: ChartNode[];
  edges: ChartEdge[];
  styles: {
    classes: Record<string, ChartStyle>;
    nodeStyles: Record<string, ChartStyle>;
    edgeStyles: Record<string, ChartStyle>;
  };
  extensions: Record<string, unknown>;
}
