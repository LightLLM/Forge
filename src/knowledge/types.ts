export type KnowledgeNodeKind =
  | "file"
  | "module"
  | "symbol"
  | "import"
  | "route"
  | "table"
  | "test"
  | "dependency";

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  path?: string;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  kind: "imports" | "calls" | "defines" | "tests" | "depends_on";
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  builtAt: string;
  root: string;
}

export interface DependencyAnswer {
  from: string;
  to: string;
  path: string[];
  found: boolean;
}
