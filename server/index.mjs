import os from "node:os";
import {planBundle,packBundle} from "./bundles.mjs";
import { installViewer } from "./viewer.mjs";
import { deleteArtifacts } from "./artifact-delete.mjs";
import { serverPaths } from "./paths.mjs";
import express from "express";
import { requestDocument } from "./documents.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { z } from "zod";
import { contextFor, toMermaid } from "./model.mjs";
import { readImplementation } from "./source.mjs";
import { recordActivity, readActivity, summarySchema } from "./activity.mjs";
import { gpuExtensions } from "./gpu.mjs";
import { openWorkspace } from "./workspaces.mjs";
import { versionStatus, previewVersion, switchVersion, commitChanges } from "./versions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {runtime, workspaceConfig, initialFolder} = serverPaths(root);
fs.mkdirSync(initialFolder, { recursive: true });
const opened = openWorkspace(initialFolder, root);
let { workspace, dataDir, artifactDir, store } = opened;
let cliPath = opened.cli;
let token = crypto.randomBytes(32).toString("hex");
const port = Number(process.env.PORT || 4310);
const origin = `http://127.0.0.1:${port}`;
const instance = crypto.randomUUID();
const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
const sessions = new Map();
let vite;
let versionChanging = false;
const authorized = (req) => req.headers.authorization === `Bearer ${token}`;
const hostOkay = (req) =>
  req.headers.host === `127.0.0.1:${port}` ||
  req.headers.host === `localhost:${port}`;
const originOkay = (req) =>
  !req.headers.origin ||
  [origin, `http://localhost:${port}`].includes(req.headers.origin);
app.use((req, res, next) => {
  if (
    !hostOkay(req) ||
    !originOkay(req) ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    return res.status(403).json({ error: "Local requests only" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.get("/health", (req, res) => res.json({ app: "ISPBlockMaker", root, workspace, instance, pid: process.pid }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.path === "/bootstrap" && req.method === "GET") return next();
  if (!authorized(req))
    return res
      .status(401)
      .json({ error: "Missing or invalid local session token" });
  if (versionChanging && req.method !== "GET")
    return res
      .status(409)
      .json({ error: "버전 전환 중입니다. 잠시 후 다시 시도하세요." });
  next();
});
app.use("/api", express.json({ limit: "16mb" }));
app.use("/api", (req,res,next)=>{
 const folder=dataDir,endpoint=req.path,method=req.method;
 if (method!=="GET" && !["/selection","/present","/activity/summaries"].includes(endpoint)) {
  let result;const json=res.json.bind(res);res.json=(body)=>{result=body;return json(body);};
  res.on("finish",()=>{try {
   const blockId=endpoint.startsWith("/global")?null:/^\/blocks\/([^/]+)/.exec(endpoint)?.[1];
   const title=endpoint.includes("jobs")?"JOB 변경":endpoint.includes("requests")?"요청 변경":endpoint==="/artifacts"?"시각화 등록":endpoint==="/versions/switch"?"구현 버전 전환":endpoint==="/workspace"?"작업 폴더 전환":endpoint==="/project"?"그래프 저장":endpoint.startsWith("/blocks")||endpoint==="/global"?"블록 / 요청 저장":"작업 실행";
   recordActivity(folder,{title,detail:res.statusCode>=400?String(result?.error||`HTTP ${res.statusCode}`).slice(0,1000):`${method} ${endpoint}`,blockId,artifactId:endpoint==="/artifacts"?result?.id:undefined,failed:res.statusCode>=400});
  }catch(e){console.error("Activity log:",e.message);}});
 }
 next();
});
installViewer(app, {
  current: () => ({workspace,state:store.get()}),
  present: (requestId,message,commandId) => {
    let delivered=0;
    for(const client of wss.clients) if(client.readyState===WebSocket.OPEN) {
      client.send(JSON.stringify({type:"present",presentation:{view:"viewer",requestId,commandId,message,blockIds:[],edgeIds:[]},state:store.get()}));delivered++;
    }
    return delivered;
  }
});
const bundleOptions=z.object({includeImages:z.boolean().default(true),includeGit:z.boolean().default(false)});
app.get('/api/bundle/preview',async(req,res)=>{const options=bundleOptions.parse({includeImages:req.query.includeImages!=='false',includeGit:req.query.includeGit==='true'});const {files,workspace:ignored,...plan}=await planBundle(workspace,options);res.json({...plan,files:files.map(({path,size})=>({path,size})),revision:store.get().revision});});
app.post('/api/bundle/export',async(req,res)=>{
 const options=bundleOptions.parse(req.body);if(req.body.revision!==undefined&&req.body.revision!==store.get().revision)return res.status(409).json({error:'프로젝트가 변경됐습니다. 목록을 새로 확인하세요.'});
 versionChanging=true;let temp;
 try{temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-share-'));const result=await packBundle(workspace,path.join(temp,'workspace.bundle'),options);versionChanging=false;const cleanup=()=>fs.rm(temp,{recursive:true,force:true},()=>{});res.download(result.path,'workspace.bundle',cleanup);}
 catch(e){versionChanging=false;if(temp)fs.rmSync(temp,{recursive:true,force:true});throw e;}
});
app.get("/api/activity",(req,res)=>res.json(readActivity(dataDir)));
app.get("/api/versions/commits/:hash",async(req,res)=>res.json(await commitChanges(workspace,req.params.hash)));
app.post("/api/activity/summaries",(req,res)=>{
 const input=summarySchema.parse(req.body);
 recordActivity(dataDir,{...input,kind:"summary",title:input.title});
 res.status(201).json(readActivity(dataDir)[0]);
});


function broadcast() {
  const message = JSON.stringify({ type: "state", state: store.get() });
  for (const client of wss.clients)
    if (client.readyState === WebSocket.OPEN) client.send(message);
}
app.get("/api/bootstrap", (req, res) => {
  res.cookie("isp_session", token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/artifacts",
  });
  res.json({ token, state: store.get(), workspace });
});
app.post("/api/documents/request", (req,res) => { const state=requestDocument(store); broadcast(); res.json(state); });
app.post("/api/shutdown", (req,res) => {
  if (req.body.instance !== instance) return res.status(409).json({error:"Server instance changed"});
  res.json({stopping:true});
  setTimeout(() => shutdown().then(() => process.exit(0)), 100);
});
app.get("/api/project", (req, res) => res.json(store.get()));
app.get("/api/gpu/extensions", async (req, res) => res.json(await gpuExtensions(workspace)));
app.get("/api/versions", async (req, res) =>
  res.json(await versionStatus(workspace, req.query.history === "1")),
);
app.get("/api/versions/preview", async (req, res) =>
  res.json(
    await previewVersion(workspace, {
      kind: req.query.kind,
      ref: req.query.ref,
    }),
  ),
);
app.post("/api/versions/switch", async (req, res) => {
  const input = z
    .object({
      target: z.object({
        kind: z.enum(["branch", "commit"]),
        ref: z.string().min(1).max(250),
      }),
      hash: z.string().regex(/^[0-9a-f]{40,64}$/),
      snapshot: z.string(),
      stopTerminals: z.literal(true),
    })
    .parse(req.body);
  if (demoRunning)
    return res
      .status(409)
      .json({ error: "실행 중인 예제가 끝난 뒤 버전을 전환하세요." });
  const selectedWorkspace = workspace;
  versionChanging = true;
  try {
    const result = await switchVersion(selectedWorkspace, input, () => {
      for (const session of sessions.values()) {
        clearTimeout(session.timer);
        try {
          session.pty.kill();
        } catch {}
      }
      sessions.clear();
    });
    store.get();
    token = crypto.randomBytes(32).toString("hex");
    if (!process.env.ISP_NO_DISCOVERY) publishConnection();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ type: "workspace-changed" }));
      client.close(1000, "Version changed");
    }
    res.json(result);
  } finally {
    versionChanging = false;
  }
});
app.get("/api/folders", (req, res) => {
  const folder = fs.realpathSync(
    typeof req.query.path === "string" && req.query.path
      ? req.query.path
      : workspace,
  );
  if (!fs.statSync(folder).isDirectory()) throw new Error("폴더가 아닙니다.");
  const directories = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && ![".git", "node_modules", ".isp"].includes(e.name),
    )
    .map((e) => ({ name: e.name, path: path.join(folder, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ path: folder, parent: path.dirname(folder), directories });
});
app.post("/api/workspace", (req, res) => {
  const input = z
    .object({ path: z.string().min(1), stopTerminals: z.literal(true) })
    .parse(req.body);
  if (demoRunning)
    return res
      .status(409)
      .json({ error: "실행 중인 예제가 끝난 뒤 폴더를 변경하세요." });
  if (process.env.ISP_WORKSPACE && fs.realpathSync(input.path) !== workspace)
    return res.status(409).json({error: "폴더별 서버입니다. 다른 폴더에서 isp-block-maker . 명령으로 새 서버를 여세요."});
  const opened = openWorkspace(input.path, root);
  if (opened.workspace === workspace) return res.json({ workspace });
  for (const session of sessions.values()) {
    clearTimeout(session.timer);
    try {
      session.pty.kill();
    } catch {}
  }
  sessions.clear();
  const oldToken = token;
  const oldDiscovery = path.join(dataDir, "connection.json");
  if (fs.existsSync(oldDiscovery)) {
    try {
      if (JSON.parse(fs.readFileSync(oldDiscovery, "utf8")).token === oldToken)
        fs.unlinkSync(oldDiscovery);
    } catch {}
  }
  ({ workspace, dataDir, artifactDir, store } = opened);
  cliPath = opened.cli;
  token = crypto.randomBytes(32).toString("hex");
  if (!process.env.ISP_NO_DISCOVERY) {
    fs.writeFileSync(workspaceConfig, JSON.stringify({ path: workspace }));
    publishConnection();
  }
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN)
      client.send(JSON.stringify({ type: "workspace-changed" }));
    client.close(1000, "Workspace changed");
  }
  res.json({ workspace });
});
app.get("/api/blocks/:id/source", async (req, res) => {
  const block = store.get().blocks.find((b) => b.id === req.params.id);
  if (!block) return res.status(404).json({ error: "Block not found" });
  try {
    res.json({
      blockId: block.id,
      ...(await readImplementation(
        workspace,
        block.implementation,
        block.implementationSymbol,
        block.id,
      )),
    });
  } catch (error) {
    res.status(400).json({
      error:
        error.code === "ENOENT"
          ? "구현 파일을 찾을 수 없습니다. 블록의 Implementation 경로를 확인하세요."
          : error.message,
    });
  }
});
function workState(state, req) {
  const global = { ...state.globalWork, id: undefined, name: "Global graph" };
  if (req.path.startsWith("/api/global/"))
    return { ...state, blocks: [global] };
  if (req.path === "/api/requests" || req.path === "/api/jobs") {
    if (req.query.scope === "global") return { ...state, blocks: [global] };
    if (!req.query.blockId)
      return { ...state, blocks: [...state.blocks, global] };
  }
  return state;
}
function saveWork(req, state, revision) {
  return req.path.startsWith("/api/global/")
    ? store.global(
        {
          userRequests: state.blocks[0].userRequests,
          jobs: state.blocks[0].jobs,
        },
        revision,
      )
    : store.graph(state, revision);
}
app.patch("/api/global", (req, res) => {
  const current = store.get();
  const state = store.global(
    { ...current.globalWork, userRequests: req.body.patch.userRequests },
    req.body.revision,
  );
  broadcast();
  res.json(state);
});
app.get("/api/requests", (req, res) => {
  const status = z
    .enum(["pending", "consumed", "all"])
    .parse(req.query.status || "pending");
  const state = workState(store.get(), req);
  if (
    req.query.blockId &&
    !state.blocks.some((b) => b.id === req.query.blockId)
  )
    return res.status(404).json({ error: "Block not found" });
  res.json({
    revision: state.revision,
    requests: state.blocks
      .filter((b) => !req.query.blockId || b.id === req.query.blockId)
      .flatMap((b) =>
        b.userRequests
          .filter((r) => status === "all" || r.status === status)
          .map((r) => ({
            ...r,
            scope: b.id === undefined ? "global" : "block",
            blockId: b.id ?? null,
            blockName: b.name,
          })),
      ),
  });
});
app.post("/api/blocks/:id/requests/:requestId/consume", (req, res) => {
  const input = z
    .object({
      revision: z.number().int().positive(),
      resolution: z.string().trim().min(1).max(12000),
    })
    .parse(req.body);
  const current = workState(store.get(), req);
  const block = current.blocks.find((b) => b.id === req.params.id);
  const memo = block?.userRequests.find((r) => r.id === req.params.requestId);
  if (!memo) return res.status(404).json({ error: "Request not found" });
  if (memo.status !== "pending")
    return res.status(409).json({ error: "이미 소비한 요청입니다." });
  const state = saveWork(
    req,
    {
      ...current,
      blocks: current.blocks.map((b) =>
        b.id !== block.id
          ? b
          : {
              ...b,
              userRequests: b.userRequests.map((r) =>
                r.id !== memo.id
                  ? r
                  : {
                      ...r,
                      status: "consumed",
                      consumedAt: new Date().toISOString(),
                      resolution: input.resolution,
                    },
              ),
            },
      ),
    },
    input.revision,
  );
  broadcast();
  res.json(state);
});
app.post(
  [
    "/api/blocks/:id/requests/:requestId/jobs",
    "/api/global/requests/:requestId/jobs",
  ],
  (req, res) => {
    const input = z
      .object({
        revision: z.number().int().positive(),
        jobs: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              description: z.string().max(12000).default(""),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    const current = workState(store.get(), req);
    const block = current.blocks.find((b) => b.id === req.params.id);
    const memo = block?.userRequests.find((r) => r.id === req.params.requestId);
    if (!memo) return res.status(404).json({ error: "Request not found" });
    if (memo.status !== "pending")
      return res
        .status(409)
        .json({ error: "이미 소비한 요청입니다. JOB 목록을 확인하세요." });
    const now = new Date().toISOString();
    const jobs = input.jobs.map((j) => ({
      ...j,
      id: crypto.randomUUID(),
      sourceRequestId: memo.id,
      status: "pending",
      createdAt: now,
      resolution: "",
    }));
    const state = saveWork(
      req,
      {
        ...current,
        blocks: current.blocks.map((b) =>
          b.id !== block.id
            ? b
            : {
                ...b,
                jobs: [...b.jobs, ...jobs],
                userRequests: b.userRequests.map((r) =>
                  r.id !== memo.id
                    ? r
                    : {
                        ...r,
                        status: "consumed",
                        consumedAt: now,
                        jobIds: jobs.map((j) => j.id),
                        resolution: `${jobs.length}개 JOB으로 분해됨`,
                      },
                ),
              },
        ),
      },
      input.revision,
    );
    broadcast();
    res.json(state);
  },
);
app.get("/api/jobs", (req, res) => {
  const status = z
    .enum(["open", "pending", "in_progress", "done", "all"])
    .parse(req.query.status || "open");
  const state = workState(store.get(), req);
  if (
    req.query.blockId &&
    !state.blocks.some((b) => b.id === req.query.blockId)
  )
    return res.status(404).json({ error: "Block not found" });
  res.json({
    revision: state.revision,
    jobs: state.blocks
      .filter((b) => !req.query.blockId || b.id === req.query.blockId)
      .flatMap((b) =>
        b.jobs
          .filter(
            (j) =>
              status === "all" ||
              (status === "open" ? j.status !== "done" : j.status === status),
          )
          .map((j) => ({
            ...j,
            scope: b.id === undefined ? "global" : "block",
            blockId: b.id ?? null,
            blockName: b.name,
          })),
      ),
  });
});
app.patch(
  ["/api/blocks/:id/jobs/:jobId", "/api/global/jobs/:jobId"],
  (req, res) => {
    const input = z
      .object({
        revision: z.number().int().positive(),
        status: z.enum(["pending", "in_progress", "done"]),
        resolution: z.string().trim().max(12000).default(""),
      })
      .parse(req.body);
    if (input.status === "done" && !input.resolution)
      throw new Error("완료한 구현 및 검증 내용을 기록하세요.");
    const current = workState(store.get(), req);
    const block = current.blocks.find((b) => b.id === req.params.id);
    const job = block?.jobs.find((j) => j.id === req.params.jobId);
    if (!job)
      return res
        .status(404)
        .json({ error: "JOB not found (삭제된 JOB은 처리하지 마세요)" });
    if (job.status === input.status)
      return res
        .status(409)
        .json({ error: "JOB이 이미 해당 상태입니다. 최신 목록을 확인하세요." });
    const state = saveWork(
      req,
      {
        ...current,
        blocks: current.blocks.map((b) =>
          b.id !== block.id
            ? b
            : {
                ...b,
                jobs: b.jobs.map((j) =>
                  j.id !== job.id
                    ? j
                    : {
                        ...j,
                        status: input.status,
                        resolution: input.resolution,
                        completedAt:
                          input.status === "done"
                            ? new Date().toISOString()
                            : undefined,
                      },
                ),
              },
        ),
      },
      input.revision,
    );
    broadcast();
    res.json(state);
  },
);
app.delete(
  ["/api/blocks/:id/jobs/:jobId", "/api/global/jobs/:jobId"],
  (req, res) => {
    const { revision } = z
      .object({ revision: z.number().int().positive() })
      .parse(req.body);
    const current = workState(store.get(), req);
    const block = current.blocks.find((b) => b.id === req.params.id);
    if (!block?.jobs.some((j) => j.id === req.params.jobId))
      return res.status(404).json({ error: "JOB not found" });
    const state = saveWork(
      req,
      {
        ...current,
        blocks: current.blocks.map((b) =>
          b.id !== block.id
            ? b
            : {
                ...b,
                jobs: b.jobs.filter((j) => j.id !== req.params.jobId),
              },
        ),
      },
      revision,
    );
    broadcast();
    res.json(state);
  },
);
app.post("/api/present", (req, res) => {
  const presentation = z
    .object({
      view: z.enum(["graph", "artifacts"]),
      blockIds: z.array(z.string()).max(200).default([]),
      edgeIds: z.array(z.string()).max(1000).default([]),
      artifactId: z.string().optional(),
      message: z.string().max(500).default(""),
    })
    .parse(req.body);
  const state = store.get();
  if (presentation.edgeIds.some((id) => !state.edges.some((e) => e.id === id)))
    throw new Error("표시할 간선을 찾을 수 없습니다.");
  if (
    presentation.view === "artifacts" &&
    (presentation.edgeIds.length || presentation.blockIds.length)
  )
    throw new Error("시각화와 그래프 강조는 함께 지정할 수 없습니다.");
  const endpoints = state.edges
    .filter((e) => presentation.edgeIds.includes(e.id))
    .flatMap((e) => [e.source, e.target]);
  presentation.blockIds = [
    ...new Set([...presentation.blockIds, ...endpoints]),
  ];
  if (
    presentation.blockIds.some((id) => !state.blocks.some((b) => b.id === id))
  )
    throw new Error("표시할 블록을 찾을 수 없습니다.");
  if (
    presentation.view === "artifacts" &&
    !state.artifacts.some((a) => a.id === presentation.artifactId)
  )
    throw new Error("표시할 결과물을 찾을 수 없습니다.");
  if (presentation.view === "graph" && presentation.artifactId)
    throw new Error("그래프 표시에는 artifactId를 지정할 수 없습니다.");
  let delivered = 0;
  for (const client of wss.clients)
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "present", presentation, state }));
      delivered++;
    }
  res.json({
    presentation,
    delivered,
    note: delivered
      ? "표시 요청 전송됨. 저장하지 않은 편집이 있는 화면에서는 적용이 보류됩니다."
      : "연결된 화면이 없습니다. 브라우저를 연 뒤 다시 요청하세요.",
  });
});
app.put("/api/project", (req, res) => {
  const state = store.graph(req.body, req.body.revision);
  broadcast();
  res.json(state);
});
app.post("/api/selection", (req, res) => {
  const state = store.select(req.body.blockId);
  broadcast();
  res.json(state);
});
app.get("/api/context", (req, res) =>
  res.json(
    contextFor(store.get(), req.query.blockId || store.get().selectedBlockId),
  ),
);
app.get("/api/mermaid", (req, res) =>
  res.type("text/plain").send(toMermaid(store.get())),
);
app.patch("/api/blocks/:id", (req, res) => {
  const current = store.get();
  if (!current.blocks.some((b) => b.id === req.params.id))
    return res.status(404).json({ error: "Block not found" });
  const state = store.graph(
    {
      ...current,
      blocks: current.blocks.map((b) =>
        b.id === req.params.id ? { ...b, ...req.body.patch, id: b.id } : b,
      ),
    },
    req.body.revision,
  );
  broadcast();
  res.json(state);
});
const artifactSchema = z.object({
  title: z.string().min(1).max(150),
  blockId: z.string(),
  kind: z.enum(["html", "png", "jpeg", "webp"]),
  content: z
    .string()
    .min(1)
    .max(15 * 1024 * 1024),
  revision: z.number().int().positive(),
  runId: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
app.delete("/api/artifacts", (req,res) => {
  const {ids}=z.object({ids:z.array(z.string().min(1)).min(1).max(1000)}).parse(req.body);
  const result=deleteArtifacts(store,artifactDir,[...new Set(ids)]);
  broadcast();
  res.json(result);
});
app.post("/api/artifacts", (req, res) => {
  const input = artifactSchema.parse(req.body);
  if (!store.get().blocks.some((b) => b.id === input.blockId))
    throw new Error("블록을 찾을 수 없습니다.");
  if (input.revision > store.get().revision)
    throw new Error("현재 revision보다 새로운 결과를 등록할 수 없습니다.");
  const id = crypto.randomUUID();
  const bytes = Buffer.from(input.content, "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error("결과물은 10MB 이하여야 합니다.");
  const file = `${id}.${input.kind}`;
  fs.writeFileSync(path.join(artifactDir, file), bytes);
  const { content, ...properties } = input;
  const artifact = {
    ...properties,
    id,
    file,
    createdAt: new Date().toISOString(),
  };
  try {
    store.artifact(artifact);
  } catch (error) {
    fs.unlinkSync(path.join(artifactDir, file));
    throw error;
  }
  broadcast();
  res.status(201).json(artifact);
});
let demoRunning = false;
app.post("/api/demo", async (req, res, next) => {
  if (!fs.existsSync(path.join(workspace, "examples", "denoise.mjs")))
    return res.status(400).json({ error: "이 저장소에는 예제가 포함되지 않습니다. 작업 폴더의 구현을 터미널에서 실행하세요." });
  if (demoRunning)
    return res.status(409).json({ error: "예제가 이미 실행 중입니다." });
  demoRunning = true;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, "scripts", "isp.mjs"), "demo"],
      {
        cwd: workspace,
        env: { ...process.env, ISP_API_URL: origin, ISP_API_TOKEN: token },
        windowsHide: true,
        timeout: 30000,
      },
    );
    res.json(JSON.parse(stdout));
  } catch (error) {
    next(error);
  } finally {
    demoRunning = false;
  }
});
app.get("/artifacts/:file", (req, res) => {
  const cookies = (req.headers.cookie || "").split(";").map((s) => s.trim());
  if (!cookies.includes(`isp_session=${token}`) && !authorized(req))
    return res.sendStatus(401);
  const artifact = store
    .get()
    .artifacts.find((a) => a.file === req.params.file);
  if (!artifact) return res.sendStatus(404);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
  );
  res
    .type(artifact.kind === "html" ? "text/html" : `image/${artifact.kind}`)
    .sendFile(path.join(artifactDir, artifact.file), { dotfiles: "allow" });
});

const send = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
};
function startTerminal(socket, message) {
  const { sessionId, agent, blockId } = z
    .object({
      sessionId: z.string().uuid(),
      agent: z.enum(["shell", "codex", "claude"]),
      blockId: z.string(),
    })
    .parse(message);
  let session = sessions.get(sessionId);
  if (!session) {
    if (sessions.size >= 8)
      throw new Error("터미널은 최대 8개까지 실행할 수 있습니다.");
    contextFor(store.get(), blockId);
    const env = {
      ...process.env,
      ISP_API_URL: origin,
      ISP_API_TOKEN: token,
      ISP_BLOCK_ID: blockId,
      ISP_CLI: cliPath,
      PATH: `${path.dirname(cliPath)}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
      TERM: "xterm-256color",
    };
    const windows = process.platform === "win32";
    const command = windows ? "cmd.exe" : process.env.SHELL || "/bin/bash";
    const args = windows
      ? [
          "/d",
          "/k",
          agent === "shell"
            ? "echo ISP workspace ready. Run: isp context"
            : agent,
        ]
      : ["-i"];
    const processPty = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd: workspace,
      env,
    });
    session = {
      pty: processPty,
      sockets: new Set(),
      buffer: "",
      blockId,
      agent,
      timer: null,
    };
    sessions.set(sessionId, session);
    const terminal = session;
    processPty.onData((data) => {
      terminal.buffer = (terminal.buffer + data).slice(-200000);
      for (const client of terminal.sockets) {
        if (client.bufferedAmount > 2 * 1024 * 1024)
          client.close(1013, "Terminal client too slow");
        else send(client, { type: "output", data });
      }
    });
    processPty.onExit(({ exitCode }) => {
      clearTimeout(terminal.timer);
      sessions.delete(sessionId);
      for (const client of terminal.sockets)
        send(client, { type: "exit", exitCode });
    });
    if (!windows)
      processPty.write(
        `function isp() { node "$ISP_CLI" "$@"; }\n${agent === "shell" ? "" : agent + "\n"}`,
      );
  }
  clearTimeout(session.timer);
  session.sockets.add(socket);
  socket.sessionId = sessionId;
  send(socket, {
    type: "started",
    blockId: session.blockId,
    agent: session.agent,
  });
  if (session.buffer) send(socket, { type: "output", data: session.buffer });
}
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, origin);
  if (url.pathname !== "/ws") return; // Vite HMR handles its own path.
  if (
    !hostOkay(req) ||
    !originOkay(req) ||
    url.searchParams.get("token") !== token
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (socket) => {
  send(socket, { type: "state", state: store.get() });
  socket.on("message", (bytes) => {
    try {
      if (versionChanging)
        throw new Error("버전 전환 중에는 터미널을 사용할 수 없습니다.");
      const message = JSON.parse(bytes.toString());
      if (message.type === "start") {
        if (socket.sessionId && sessions.has(socket.sessionId))
          throw new Error("이미 터미널에 연결되어 있습니다.");
        startTerminal(socket, message);
        return;
      }
      const session = sessions.get(socket.sessionId);
      if (!session) throw new Error("터미널을 먼저 시작하세요.");
      if (message.type === "input")
        session.pty.write(z.string().max(65536).parse(message.data));
      else if (message.type === "resize")
        session.pty.resize(
          z.number().int().min(2).max(500).parse(message.cols),
          z.number().int().min(2).max(300).parse(message.rows),
        );
      else if (message.type === "stop") session.pty.kill();
    } catch (error) {
      console.error("Terminal request failed:", error.message);
      send(socket, { type: "error", error: error.message });
    }
  });
  socket.on("close", () => {
    const session = sessions.get(socket.sessionId);
    if (!session) return;
    session.sockets.delete(socket);
    if (!session.sockets.size)
      session.timer = setTimeout(() => {
        try {
          session.pty.kill();
        } catch {}
      }, 60000);
  });
});

if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { server, path: "/hmr" } },
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, "dist")));
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
}
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 400).json({
    error:
      error instanceof z.ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : error.message,
  });
});
function publishConnection() {
  for (const folder of new Set([runtime, dataDir]))
    fs.writeFileSync(
      path.join(folder, "connection.json"),
      JSON.stringify({ url: origin, token, workspace }),
      { mode: 0o600 },
    );
}
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Close the other server or choose another PORT.` : error.message); process.exitCode=1; });
server.listen(port, "127.0.0.1", () => {
  fs.mkdirSync(runtime, { recursive: true });
  if (!process.env.ISP_NO_DISCOVERY) publishConnection();
  console.log(`ISP Block Maker → ${origin}\nWorkspace: ${workspace}`);
});
async function shutdown() {
  for (const session of sessions.values()) {
    clearTimeout(session.timer);
    if (process.platform === "win32") {
      await promisify(execFile)("taskkill.exe", ["/PID", String(session.pty.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => {});
    }
    try {
      session.pty.kill();
    } catch {}
  }
  for (const socket of wss.clients) socket.terminate();
  for (const folder of new Set([runtime, dataDir])) {
    const discovery = path.join(folder, "connection.json");
    try { if (JSON.parse(fs.readFileSync(discovery, "utf8")).token === token) fs.unlinkSync(discovery); } catch {}
  }
  await vite?.close();
  server.close();
}
process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
