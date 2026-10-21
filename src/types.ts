export type Port = {
  id: string;
  name: string;
  type: "image" | "mask" | "signal";
};
export type HarnessStep={phase?:string;acceptance?:string;inputNotes?:string;outputNotes?:string;provider?:'inherit'|'claude'|'codex';maxVisits?:number;review?:boolean;kind:'agent'|'run'|'manual';prompt:string;skills:string[];recipeId:string;parameters:Record<string,string|number|boolean>;timeoutSeconds:number};
export type Block = {
  harnessStep?:HarnessStep;
  diagramId?: string;
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
    sourceRequestId?: string;
    sourceRequestIds?: string[];
    sourceJobs?: {id:string;title:string;description:string;createdAt:string;resolution:string;sourceRequestIds:string[]}[];
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
  detail?: string;
  implementation: string;
  implementationSymbol?: string;
  implementationLine?: number;
  agentContract?: {
    inputs?: string;
    outputs?: string;
    notes?: string;
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
  updatedAt?: string;
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
  diagrams: {id:string;name:string;kind?:'pipeline'|'harness';harness?:{entry:string;maxSteps:number;maxVisits:number;resources?:string[]};overview?:Project["overview"]}[];
  selectedDiagramId:string;
  overview?: {description: string; detail: string; entryPoint: string; agentNotes: string};
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
  view: "graph" | "artifacts" | "viewer";
  requestId?: string;
  commandId?: string;
  blockIds: string[];
  edgeIds?: string[];
  artifactId?: string;
  message: string;
};
