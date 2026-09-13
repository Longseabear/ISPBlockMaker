import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  initialProject,
  validateGraph,
  userRequestSchema,
  jobSchema,
} from "./model.mjs";
import { z } from "zod";

export function graphSpec(input) {
  const graph = validateGraph(input);
  return {
    name: graph.name,
    blocks: graph.blocks.map(({ userRequests, jobs, ...block }) => block),
    edges: graph.edges,
  };
}
export function createStore(
  directory,
  graphFile = path.join(directory, "graph.json"),
) {
  const fingerprint = (spec) =>
    crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.dirname(graphFile), { recursive: true });
  const file = path.join(directory, "project.json");
  const journal = path.join(directory, "storage-transaction.json");
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  function write(p, value) {
    const text = JSON.stringify(value, null, 2) + "\n";
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === text) return;
    fs.writeFileSync(`${p}.tmp`, text);
    fs.renameSync(`${p}.tmp`, p);
  }
  if (fs.existsSync(journal)) {
    const pending = read(journal);
    write(graphFile, pending.spec);
    write(file, pending.local);
    fs.unlinkSync(journal);
  }
  let local = fs.existsSync(file) ? read(file) : {};
  if (local.storageVersion !== 2) {
    const legacy = local.blocks ? local : structuredClone(initialProject);
    const backup = path.join(directory, "project.legacy.json");
    if (fs.existsSync(file) && !fs.existsSync(backup))
      fs.copyFileSync(file, backup);
    if (!fs.existsSync(graphFile)) write(graphFile, graphSpec(legacy));
    local = {
      storageVersion: 2,
      revision: legacy.revision,
      selectedBlockId: legacy.selectedBlockId,
      artifacts: legacy.artifacts || [],
      blocks: legacy.blocks.map((b) => ({
        id: b.id,
        userRequests: b.userRequests || [],
        jobs: b.jobs || [],
      })),
    };
    write(file, local);
  }
  let state, loadedSpec;
  function combine(spec) {
    return {
      ...spec,
      revision: local.revision,
      selectedBlockId: spec.blocks.some((b) => b.id === local.selectedBlockId)
        ? local.selectedBlockId
        : spec.blocks[0].id,
      artifacts: local.artifacts,
      globalWork: local.globalWork || { userRequests: [], jobs: [] },
      blocks: spec.blocks.map((b) => {
        const work = local.blocks.find((item) => item.id === b.id);
        return {
          ...b,
          userRequests: work?.userRequests || [],
          jobs: work?.jobs || [],
        };
      }),
    };
  }
  function refresh() {
    const spec = graphSpec(read(graphFile));
    const key = fingerprint(spec);
    if (key !== loadedSpec) {
      if (local.graphKey && local.graphKey !== key) local.revision++;
      local.graphKey = key;
      state = combine(spec);
      local.selectedBlockId = state.selectedBlockId;
      write(file, local);
      loadedSpec = key;
    }
    return state;
  }
  function persist(next) {
    const spec = graphSpec(next);
    // Preserve local work for nodes absent from a checked-out graph.
    const records = new Map(local.blocks.map((b) => [b.id, b]));
    for (const b of next.blocks)
      records.set(b.id, {
        id: b.id,
        userRequests: b.userRequests || [],
        jobs: b.jobs || [],
      });
    const nextLocal = {
      storageVersion: 2,
      revision: next.revision,
      selectedBlockId: next.selectedBlockId,
      artifacts: next.artifacts,
      globalWork: next.globalWork || { userRequests: [], jobs: [] },
      blocks: [...records.values()],
      graphKey: fingerprint(spec),
    };
    write(journal, { spec, local: nextLocal });
    write(graphFile, spec);
    write(file, nextLocal);
    fs.unlinkSync(journal);
    local = nextLocal;
    loadedSpec = nextLocal.graphKey;
    state = combine(spec);
    return state;
  }
  refresh();
  return {
    get: refresh,
    global(input, revision) {
      refresh();
      if (revision !== state.revision) {
        const error = new Error(
          "revision 충돌: 최신 프로젝트를 다시 확인하세요.",
        );
        error.status = 409;
        throw error;
      }
      const work = z
        .object({
          userRequests: z.array(userRequestSchema).max(200),
          jobs: z.array(jobSchema).max(1000),
        })
        .parse(input);
      for (const list of [work.userRequests, work.jobs])
        if (new Set(list.map((v) => v.id)).size !== list.length)
          throw new Error("요청/JOB ID 중복");
      return persist({
        ...state,
        globalWork: work,
        revision: state.revision + 1,
      });
    },
    graph(input, expectedRevision) {
      refresh();
      if (expectedRevision !== state.revision) {
        const error = new Error(
          "다른 작업이 프로젝트를 변경했습니다. 최신 상태를 불러온 후 다시 저장하세요.",
        );
        error.status = 409;
        throw error;
      }
      const graph = validateGraph(input);
      return persist({
        ...state,
        ...graph,
        revision: state.revision + 1,
        selectedBlockId: graph.blocks.some(
          (b) => b.id === state.selectedBlockId,
        )
          ? state.selectedBlockId
          : graph.blocks[0].id,
      });
    },
    select(id) {
      refresh();
      if (!state.blocks.some((b) => b.id === id))
        throw new Error("블록을 찾을 수 없습니다.");
      return persist({ ...state, selectedBlockId: id });
    },
    artifact(artifact) {
      refresh();
      return persist({ ...state, artifacts: [...state.artifacts, artifact] });
    },
    removeArtifacts(ids) {
      refresh();
      return persist({ ...state, artifacts: state.artifacts.filter(a => !ids.includes(a.id)) });
    },
  };
}
