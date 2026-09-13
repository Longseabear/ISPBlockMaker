export type Port = {
  id: string;
  name: string;
  type: "image" | "mask" | "signal";
};
export type Block = {
  id: string;
  userRequests?: {
    id: string;
    text: string;
    status: "pending" | "consumed";
    createdAt: string;
    consumedAt?: string;
    resolution: string;
    jobIds?: string[];
  }[];
  jobs?: {
    id: string;
    sourceRequestId: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "done";
    createdAt: string;
    completedAt?: string;
    resolution: string;
  }[];
  name: string;
  description: string;
  principle: string;
  implementation: string;
  implementationSymbol?: string;
  agentContract?: {
    dataFormat: string;
    boundaries: string;
    numerics: string;
    steps: string;
    validation: string;
    acceptance: string;
  };
  status: "draft" | "implemented";
  inputs: Port[];
  outputs: Port[];
  parameters: Record<string, number | string | boolean>;
  position: { x: number; y: number };
};
export type Edge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};
export type Artifact = {
  id: string;
  title: string;
  blockId: string;
  kind: string;
  file: string;
  revision: number;
  runId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};
export type Project = {
  globalWork?: {
    userRequests: NonNullable<Block["userRequests"]>;
    jobs: NonNullable<Block["jobs"]>;
  };
  name: string;
  revision: number;
  blocks: Block[];
  edges: Edge[];
  selectedBlockId: string;
  artifacts: Artifact[];
};
export type Api = <T = Project>(
  endpoint: string,
  body?: unknown,
  method?: string,
) => Promise<T>;
export type Presentation = {
  view: "graph" | "artifacts";
  blockIds: string[];
  edgeIds?: string[];
  artifactId?: string;
  message: string;
};
