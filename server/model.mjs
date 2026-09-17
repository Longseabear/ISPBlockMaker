import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const userRequestSchema = z.object({
  id,
  text: z.string().trim().min(1).max(12000),
  status: z.enum(["pending", "consumed"]).default("pending"),
  createdAt: z.iso.datetime(),
  consumedAt: z.iso.datetime().optional(),
  resolution: z.string().max(12000).default(""),
  jobIds: z.array(id).default([]),
});
export const jobSchema = z.object({
  id,
  sourceRequestId: id.optional(),
  sourceRequestIds: z.array(id).max(1000).optional(),
  sourceJobs: z.array(z.object({id,title:z.string().max(200),description:z.string().max(12000),createdAt:z.iso.datetime(),resolution:z.string().max(12000),sourceRequestIds:z.array(id).max(1000)})).max(1000).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(12000).default(""),
  status: z.enum(["pending", "in_progress", "done"]).default("pending"),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  resolution: z.string().max(12000).default(""),
});
const port = z.object({
  id,
  name: z.string().min(1).max(80),
  type: z.enum(["image", "mask", "signal"]),
});
export const blockSchema = z.object({
  id,
  userRequests: z.array(userRequestSchema).max(200).default([]),
  jobs: z.array(jobSchema).max(1000).default([]),
  name: z.string().min(1).max(100),
  description: z.string().max(12000),
  detail: z.string().max(30000).default(""),
  principle: z.string().max(20000),
  implementation: z.string().max(1000),
  implementationSymbol: z.string().max(200).default(""),
  agentContract: z
    .object({
      inputs: z.string().max(12000).default(""),
      outputs: z.string().max(12000).default(""),
      notes: z.string().max(30000).default(""),
      dataFormat: z.string().max(6000).default(""),
      boundaries: z.string().max(6000).default(""),
      numerics: z.string().max(6000).default(""),
      steps: z.string().max(12000).default(""),
      validation: z.string().max(6000).default(""),
      acceptance: z.string().max(6000).default(""),
    })
    .default({
      inputs: "",
      outputs: "",
      notes: "",
      dataFormat: "",
      boundaries: "",
      numerics: "",
      steps: "",
      validation: "",
      acceptance: "",
    }),
  status: z.enum(["draft", "implemented"]),
  inputs: z.array(port).max(16),
  outputs: z.array(port).max(16),
  parameters: z.record(
    z.string(),
    z.union([z.number().finite(), z.string(), z.boolean()]),
  ),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
});
export const overviewSchema = z.object({
  description: z.string().max(12000).default(""),
  detail: z.string().max(30000).default(""),
  entryPoint: z.string().max(12000).default(""),
  agentNotes: z.string().max(30000).default(""),
});
export const graphSchema = z.object({
  overview: overviewSchema.default(() => overviewSchema.parse({})),
  name: z.string().min(1).max(100),
  blocks: z.array(blockSchema).min(1).max(200),
  edges: z
    .array(
      z.object({
        id,
        source: id,
        target: id,
        sourceHandle: id,
        targetHandle: id,
      }),
    )
    .max(1000),
});

export function validateGraph(input) {
  const graph = graphSchema.parse(input);
  const blocks = new Map(graph.blocks.map((b) => [b.id, b]));
  if (blocks.size !== graph.blocks.length)
    throw new Error("블록 ID가 중복되었습니다.");
  const edgeIds = new Set(),
    targets = new Set();
  for (const b of graph.blocks) {
    if (new Set(b.jobs.map((j) => j.id)).size !== b.jobs.length)
      throw new Error("JOB ID가 중복되었습니다.");
    if (new Set(b.userRequests.map((r) => r.id)).size !== b.userRequests.length)
      throw new Error("요청 ID가 중복되었습니다.");
    for (const ports of [b.inputs, b.outputs]) {
      if (new Set(ports.map((p) => p.id)).size !== ports.length)
        throw new Error("포트 ID가 중복되었습니다.");
    }
  }
  const adjacency = new Map(graph.blocks.map((b) => [b.id, []]));
  for (const e of graph.edges) {
    const output = blocks
      .get(e.source)
      ?.outputs.find((p) => p.id === e.sourceHandle);
    const inputPort = blocks
      .get(e.target)
      ?.inputs.find((p) => p.id === e.targetHandle);
    if (!output || !inputPort)
      throw new Error("연결할 블록 또는 포트가 없습니다.");
    if (output.type !== inputPort.type)
      throw new Error("입출력 데이터 유형이 맞지 않습니다.");
    const target = `${e.target}:${e.targetHandle}`;
    if (edgeIds.has(e.id) || targets.has(target))
      throw new Error("한 입력 포트에는 하나의 출력만 연결할 수 있습니다.");
    edgeIds.add(e.id);
    targets.add(target);
    adjacency.get(e.source).push(e.target);
  }
  const visiting = new Set(),
    visited = new Set();
  function visit(node) {
    if (visiting.has(node)) throw new Error("순환 연결은 지원하지 않습니다.");
    if (visited.has(node)) return;
    visiting.add(node);
    adjacency.get(node).forEach(visit);
    visiting.delete(node);
    visited.add(node);
  }
  blocks.forEach((_, key) => visit(key));
  return graph;
}

export function contextFor(state, blockId) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error("선택한 블록이 없습니다.");
  const connections = state.edges.filter(
    (e) => e.source === blockId || e.target === blockId,
  );
  const neighbors = new Set(connections.flatMap((e) => [e.source, e.target]));
  return {
    project: state.name,
    overview: overviewSchema.parse(state.overview || {}),
    revision: state.revision,
    block,
    human: { summary: block.description, detail: block.detail || "", status: block.status },
    agent: {
      userRequests: block.userRequests || [],
      jobs: block.jobs || [],
      algorithm: block.principle,
      implementation: block.implementation,
      implementationSymbol: block.implementationSymbol || "",
      contract: blockSchema.parse(block).agentContract,
      shared: {
        inputs: block.inputs,
        outputs: block.outputs,
        parameters: block.parameters,
      },
      guidance:
        "Read the implementation files before editing. Empty contract fields are unspecified, not guarantees. Use the project revision when updating metadata or registering results.",
    },
    neighbors: state.blocks.filter(
      (b) => b.id !== blockId && neighbors.has(b.id),
    ),
    connections,
    artifacts: state.artifacts.filter((a) => a.blockId === blockId),
  };
}

export function toMermaid(state) {
  const names = new Map(state.blocks.map((b, i) => [b.id, `n${i}`]));
  const escape = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replace(/[\r\n]/g, " ");
  return [
    "flowchart LR",
    ...state.blocks.map((b) => `  ${names.get(b.id)}["${escape(b.name)}"]`),
    ...state.edges.map(
      (e) =>
        `  ${names.get(e.source)} -->|"${escape(e.sourceHandle)} → ${escape(e.targetHandle)}"| ${names.get(e.target)}`,
    ),
  ].join("\n");
}

export const initialProject = {
  name: "Adaptive denoise",
  revision: 1,
  selectedBlockId: "flat-detection",
  blocks: [
    {
      id: "input",
      name: "Image input",
      description: "입력 영상을 파이프라인에 전달합니다.",
      principle:
        "예제는 96 × 64 정규화된 단일 채널 합성 영상을 사용합니다. 실제 RAW 디코더는 후속 구현 대상입니다.",
      implementation: "examples/denoise.mjs",
      status: "implemented",
      inputs: [],
      outputs: [{ id: "image", name: "Image", type: "image" }],
      parameters: { width: 96, height: 64 },
      position: { x: 45, y: 145 },
    },
    {
      id: "flat-detection",
      name: "Flat detection",
      description: "주변 픽셀의 분산으로 평탄 영역을 분류합니다.",
      principle:
        "3 × 3 윈도우의 평균과 분산을 계산합니다. 분산이 threshold보다 작으면 flat mask = 1입니다. 경계에서는 좌표를 clamp합니다.",
      implementation: "examples/denoise.mjs",
      status: "implemented",
      inputs: [{ id: "image", name: "Image", type: "image" }],
      outputs: [{ id: "mask", name: "Flat mask", type: "mask" }],
      parameters: { threshold: 0.004 },
      position: { x: 340, y: 50 },
    },
    {
      id: "denoise",
      name: "Adaptive denoise",
      description: "평탄 영역을 선택적으로 평활화하고 에지 영역을 보존합니다.",
      principle:
        "flat mask = 1인 픽셀만 원본과 3 × 3 평균을 strength 비율로 혼합합니다. 그 외에는 원본을 유지합니다. 고정소수점/RTL 구현 전의 부동소수점 참조 모델입니다.",
      implementation: "examples/denoise.mjs",
      status: "implemented",
      inputs: [
        { id: "image", name: "Image", type: "image" },
        { id: "mask", name: "Flat mask", type: "mask" },
      ],
      outputs: [{ id: "image", name: "Denoised", type: "image" }],
      parameters: { strength: 0.85 },
      position: { x: 640, y: 145 },
    },
  ],
  edges: [
    {
      id: "input-flat",
      source: "input",
      sourceHandle: "image",
      target: "flat-detection",
      targetHandle: "image",
    },
    {
      id: "input-denoise",
      source: "input",
      sourceHandle: "image",
      target: "denoise",
      targetHandle: "image",
    },
    {
      id: "mask-denoise",
      source: "flat-detection",
      sourceHandle: "mask",
      target: "denoise",
      targetHandle: "mask",
    },
  ],
  artifacts: [],
};
