export type JobRef = { blockId: string | null; jobId: string };

export type WorkAttempt = {
  id: string;
  title: string;
  approach: string;
  inputConditions: string;
  summary: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  jobRefs: JobRef[];
  jobSnapshots?: { blockId: string | null; jobId: string; job: { title: string; description: string } }[];
  parameterSnapshot?: { blockId: string; parameters: Record<string, unknown> }[];
  blockIds: string[];
  validation: string[];
  artifactIds: string[];
  baselineCheckpointId: string;
  resultCheckpointId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type Checkpoint = {
  id: string;
  title: string;
  hash: string;
  treeHash: string;
  createdAt: string;
  kind: "manual" | "baseline" | "result" | "safety";
  sourceHead: string | null;
  sourceBranch: string | null;
  available: boolean;
};

export type TrackingCurrent = {
  root?: string;
  available: boolean;
  reason?: string;
  headHash: string | null;
  branch: string | null;
  treeHash: string | null;
  checkpointId: string | null;
  dirty: boolean;
  snapshot: string | null;
};

export type TrackingState = {
  schemaVersion: number;
  attempts: WorkAttempt[];
  checkpoints: Checkpoint[];
  acceptedAttemptId: string | null;
  lastAttemptId: string | null;
  current: TrackingCurrent;
};

export type CheckpointPreview = {
  checkpoint: Checkpoint;
  current: TrackingCurrent;
  snapshot: string;
  files: string[];
  stats: string;
  blockedReason: string | null;
};

export type CheckpointComparison = {
  from: Checkpoint;
  to: Checkpoint;
  files: string[];
  stats: string;
  patch: string;
  truncated: boolean;
  blockChanges: { id: string; name: string; status: string; fields: string[] }[];
};
