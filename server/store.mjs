import {readGraph,writeGraph,planGraph,backupLegacyGraph} from './graph-storage.mjs';
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  initialProject,
  validateGraph,
  diagramSchema,
  userRequestSchema,
  jobSchema,
} from "./model.mjs";
import { z } from "zod";

export function graphSpec(input) {
  const graph = validateGraph(input);
  return {
    name: graph.name,
    diagrams: graph.diagrams,
    overview: graph.overview,
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
    if(pending.writeGraph!==false)writeGraph(graphFile, pending.spec);
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
    const selectedDiagramId=spec.diagrams.some(d=>d.id===local.selectedDiagramId)?local.selectedDiagramId:spec.diagrams[0].id;
    const diagramBlocks=spec.blocks.filter(b=>b.diagramId===selectedDiagramId);
    return {
      selectedDiagramId,
      ...spec,
      revision: local.revision,
      selectedBlockId: diagramBlocks.some((b) => b.id === local.selectedBlockId)
        ? local.selectedBlockId
        : diagramBlocks[0]?.id||'',
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
    const spec = graphSpec(readGraph(graphFile));
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
      selectedDiagramId:next.selectedDiagramId,
      artifacts: next.artifacts,
      globalWork: next.globalWork || { userRequests: [], jobs: [] },
      blocks: [...records.values()],
      graphKey: fingerprint(spec),
    };
    const graphChanged=fingerprint(spec)!==loadedSpec;
    if(graphChanged){planGraph(graphFile,spec);if(read(graphFile).storageVersion!==3)backupLegacyGraph(graphFile,directory);}
    write(journal, { spec, local: nextLocal, writeGraph:graphChanged });
    if(graphChanged)writeGraph(graphFile, spec);
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
    migrate(){refresh();if(read(graphFile).storageVersion===3)return state;planGraph(graphFile,state);backupLegacyGraph(graphFile,directory);loadedSpec=null;return persist(state);},
    global(input, revision, overview) {
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
        overview: overview === undefined ? state.overview : validateGraph({...state, overview}).overview,
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

      if(input.diagramId){
        const diagram=state.diagrams.find(d=>d.id===input.diagramId);
        if(!diagram)throw Error('Diagram not found');
        const kept=state.blocks.filter(b=>b.diagramId!==diagram.id),ids=new Set(kept.map(b=>b.id));
        if(input.blocks.some(b=>ids.has(b.id)||b.diagramId&&b.diagramId!==diagram.id))throw Error('Block belongs to another diagram');
        input={...state,blocks:[...kept,...input.blocks.map(b=>({...b,diagramId:diagram.id}))],edges:[...state.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),...input.edges],diagrams:state.diagrams.map(d=>d.id===diagram.id?{...d,overview:input.overview??d.overview}:d)};
      }
      const graph = validateGraph({...input, diagrams:input.diagrams??state.diagrams, blocks:input.blocks.map(b=>({...b,diagramId:b.diagramId||state.blocks.find(old=>old.id===b.id)?.diagramId||state.selectedDiagramId})), overview: input.overview ?? state.overview});
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
      return persist({ ...state, selectedBlockId: id, selectedDiagramId:state.blocks.find(b=>b.id===id).diagramId });
    },

    diagram(action, input, revision) {
      refresh();
      if(action!=='select' && revision!==state.revision)throw Object.assign(Error('revision conflict: reload diagrams'),{status:409});
      if(action==='select'){
        if(!state.diagrams.some(d=>d.id===input.id))throw Error('Diagram not found');
        return persist({...state,selectedDiagramId:input.id,selectedBlockId:state.blocks.find(b=>b.diagramId===input.id)?.id||''});
      }
      if(action==='create'){
        const diagram=diagramSchema.parse(input);
        if(state.diagrams.some(d=>d.id===diagram.id))throw Error('Diagram ID already exists');
        return persist({...state,diagrams:[...state.diagrams,diagram],selectedDiagramId:diagram.id,selectedBlockId:'',revision:state.revision+1});
      }
      const current=state.diagrams.find(d=>d.id===input.id);
      if(!current)throw Error('Diagram not found');
      if(action==='delete'){
        if(state.diagrams.length===1)throw Error('Cannot remove the last diagram');
        if(state.blocks.some(b=>b.diagramId===input.id))throw Error('Only empty diagrams can be removed; move or remove blocks first');
        return persist({...state,diagrams:state.diagrams.filter(d=>d.id!==input.id),revision:state.revision+1});
      }
      const diagram=diagramSchema.parse({...current,...input});
      return persist({...state,diagrams:state.diagrams.map(d=>d.id===input.id?diagram:d),revision:state.revision+1});
    },
    artifact(artifact) {
      refresh();
      return persist({ ...state, artifacts: [...state.artifacts, artifact] });
    },
    updateArtifact(id, expectedFile, patch) {
      refresh();
      const previous=state.artifacts.find(a=>a.id===id);
      if(!previous)throw Object.assign(new Error('리포트를 찾을 수 없습니다.'),{status:404});
      if(previous.file!==expectedFile)throw Object.assign(new Error('리포트가 변경되었습니다. 최신 리포트를 확인한 뒤 수정 내용을 병합하세요.'),{status:409});
      const artifact={...previous,...patch,id};
      persist({...state,artifacts:state.artifacts.map(a=>a.id===id?artifact:a)});
      return artifact;
    },
    removeArtifacts(ids) {
      refresh();
      return persist({ ...state, artifacts: state.artifacts.filter(a => !ids.includes(a.id)) });
    },
  };
}
