import {WorkspaceSearchService} from './workspace-search-service.mjs';
import {workspaceMcpHandler} from './workspace-mcp.mjs';
import {localApiAdapter} from './mcp-local-tools.mjs';
import {installMcpSharing} from './mcp-sharing.mjs';
import {McpMutations} from './mcp-mutations.mjs';
import {applyGraphOperations} from './graph-operations.mjs';
import {readArtifactFile} from './mcp-artifact-tools.mjs';
import {sharedImages,sharedImagePreview} from './mcp-shared-images.mjs';
import {installHarness} from './harness.mjs';
import {blockStorageDirectory,blockDocuments,safeGraphPath} from './graph-storage.mjs';
import {listRecipes,readRecipe,saveRecipe,deleteRecipe,planRecipeRun} from './recipes.mjs';
import {installInteraction} from './interaction.mjs';
import {installPersonalAgentApi} from './personal-agent-api.mjs';
import {installMcpSettings,prepareMcpLaunch} from './mcp-settings.mjs';
import {installAppUpdates} from './app-updates.mjs';
import { graphCheck } from "./graph-check.mjs";
import {listWorkspaces} from './workspace-registry.mjs';
import { installReportSharing } from './report-sharing.mjs';
import {restructureJobs,restructureSchema} from './job-restructure.mjs';
import {openWorkspaceServer, findWorkspaceServer} from './workspace-open.mjs';
import {installBundleImport} from "./bundle-import.mjs";
import os from "node:os";
import {planBundle,packBundle,bundleFilename} from "./bundles.mjs";
import { installViewer } from "./viewer.mjs";
import { deleteArtifacts } from "./artifact-delete.mjs";
import { updateArtifact } from './artifact-update.mjs';
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
import { contextFor, toMermaid, diagramView } from "./model.mjs";
import { readImplementation } from "./source.mjs";
import { recordActivity, readActivity, summarySchema } from "./activity.mjs";
import { openWorkspace } from "./workspaces.mjs";
import { versionStatus, previewVersion, switchVersion, commitChanges } from "./versions.mjs";
import { sourceRoot } from "./project-layout.mjs";
import {installProjectSkills,listProjectSkills} from './project-skills.mjs';
import { listTracking, createAttempt, updateAttempt, acceptAttempt, createCheckpoint, previewRestore, restoreCheckpoint, compareCheckpoints } from "./tracking.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {runtime, workspaceConfig, initialFolder} = serverPaths(root);
fs.mkdirSync(initialFolder, { recursive: true });
const existingServer = await findWorkspaceServer(initialFolder);
if (existingServer) throw new Error(`Workspace server is already running at ${existingServer}. Open it, or stop it before restarting. No workspace files were moved.`);
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
let interaction;
let vite;
let versionChanging = false;
let workspaceReplacing = false;
let workspaceRecoveryError = '';
function workspaceInfo() {
  const source = sourceRoot(workspace);
  return {workspace, sourceRoot: source, graphFile: path.join(source, "graph.json"), dataDir, tmpDir: path.join(workspace, "tmp"), layoutVersion: source === workspace ? 0 : 1};
}
function stopTerminals() {
  interaction?.close();
  for (const session of sessions.values()) {
    clearTimeout(session.timer);
    try { session.pty.kill();session.mcpCleanup?.(); } catch {}
  }
  sessions.clear();
}
function sourceChanged(bundleRestore) {
  void mcpSharing.stop();
  store.get();
  token = crypto.randomBytes(32).toString("hex");
  if (!process.env.ISP_NO_DISCOVERY) publishConnection();
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({type: "workspace-changed", ...(bundleRestore ? {bundleRestore} : {})}));
    client.close(1000, "Version changed");
  }
}
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
app.get("/health", (req, res) => res.json({ app: "ISPBlockMaker", root, workspace, instance, pid: process.pid, agentApi:1 }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (workspaceRecoveryError) return res.status(503).json({error:workspaceRecoveryError});
  if (workspaceReplacing) return res.status(409).json({error:"번들에서 작업 폴더를 복원 중입니다. 잠시 후 다시 시도하세요."});
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
 if (method!=="GET" && !["/selection","/present","/activity/summaries","/graph-check","/shutdown","/viewer/view","/viewer/view/hidden","/bundle/import/preview","/bundle/import/destination"].includes(endpoint) && !endpoint.startsWith("/bundle/import/preview/")) {
  let result;const json=res.json.bind(res);res.json=(body)=>{result=body;return json(body);};
  res.on("finish",()=>{try {
   const blockId=endpoint.startsWith("/global")?null:/^\/blocks\/([^/]+)/.exec(endpoint)?.[1];
   const trackingTitle=endpoint==="/attempts"?`작업 시도 · ${result?.title||req.body.title||"등록"}`:endpoint.startsWith("/attempts/")?`${endpoint.endsWith("/accept")?"결과 채택":"시도 기록"} · ${result?.attempt?.title||result?.title||"작업 시도"}`:endpoint.startsWith("/checkpoints")?`${endpoint.endsWith("/restore")?"구현 복원":"체크포인트"} · ${result?.checkpoint?.title||result?.title||req.body.title||"구현"}`:null;
   const title=trackingTitle||(endpoint.includes("jobs")?"JOB 변경":endpoint.includes("requests")?"요청 변경":endpoint.startsWith("/artifacts/")&&method==="PATCH"?"시각화 수정":endpoint==="/artifacts"?"시각화 등록":endpoint==="/versions/switch"?"구현 버전 전환":endpoint==="/workspace"?"작업 폴더 전환":endpoint==="/project"?"그래프 저장":endpoint.startsWith("/blocks")||endpoint==="/global"?"블록 / 요청 저장":"작업 실행");
   recordActivity(folder,{title,detail:res.statusCode>=400?String(result?.error||`HTTP ${res.statusCode}`).slice(0,1000):trackingTitle?(result?.summary||result?.approach||result?.attempt?.summary||result?.checkpoint?.hash||result?.hash||""):`${method} ${endpoint}`,blockId,artifactId:endpoint.startsWith("/artifacts")?result?.id:undefined,failed:res.statusCode>=400});
  }catch(e){console.error("Activity log:",e.message);}});
 }
 next();
});
const workspaceSearch=new WorkspaceSearchService(()=>({sourceRoot:sourceRoot(workspace),dataDir,store}));
const mcpMutationStores=new WeakMap();
function localMcpContext(){
 const requestToken=token,requestStore=store,requestWorkspace=workspace;
 let ledger=mcpMutationStores.get(store);if(!ledger){ledger=new McpMutations(dataDir);mcpMutationStores.set(store,ledger);}
 return {store,search:workspaceSearch,readArtifact:file=>readArtifactFile(requestWorkspace,file),localApi:localApiAdapter({origin,token:()=>requestToken}),mutate:(name,input,operation)=>{
  if(requestStore!==store||requestToken!==token)throw Error('Workspace changed; reconnect before editing');
  return ledger.execute(name,input,operation);
 }};
}
app.post('/api/search',async(req,res)=>res.json(await workspaceSearch.search(req.body)));
app.post('/api/search/read',async(req,res)=>res.json(await workspaceSearch.read(req.body)));
app.post('/mcp',(req,res,next)=>{if(!authorized(req))return res.status(401).json({error:'Missing or invalid local session token'});if(workspaceRecoveryError||workspaceReplacing||versionChanging)return res.status(409).json({error:'Workspace unavailable'});next();},express.json({limit:'256kb'}),workspaceMcpHandler(localMcpContext));
app.all('/mcp',(_req,res)=>res.status(405).end());
const mcpSharing=installMcpSharing(app,()=>({store,search:workspaceSearch,sharedImages:{list:()=>sharedImages(workspace),read:id=>sharedImagePreview(workspace,id)}}));
const reportSharing = installReportSharing(app, path.join(runtime,'report-shares'),()=>({artifactDir,artifacts:store.get().artifacts}));
const viewer = installViewer(app, {
  current: () => ({workspace,state:store.get()}),
  present: (requestId,message,commandId) => {
    let delivered=0;
    for(const client of wss.clients) if(client.readyState===WebSocket.OPEN) {
      client.send(JSON.stringify({type:"present",presentation:{view:"viewer",requestId,commandId,message,blockIds:[],edgeIds:[]},state:store.get()}));delivered++;
    }
    return delivered;
  }
});
installBundleImport(app,{
  root,
  current:()=>workspace,
  beforeReplace:async destination=>{
    const active=process.platform==='win32'?path.resolve(destination).toLowerCase()===path.resolve(workspace).toLowerCase():path.resolve(destination)===path.resolve(workspace);
    if(!active)return {active:false};
    if(harness?.busy())throw new Error("하네스를 중지한 뒤 작업 폴더를 복원하세요.");
    if(demoRunning||versionChanging||workspaceReplacing)throw new Error("현재 실행 또는 저장 작업이 끝난 뒤 다시 복원하세요.");
    workspaceReplacing=true;versionChanging=true;
    try {
      for(const session of sessions.values()) {
        if(process.platform==='win32')await promisify(execFile)('taskkill.exe',['/PID',String(session.pty.pid),'/T','/F'],{windowsHide:true,timeout:5000}).catch(()=>{});
      }
      stopTerminals();
      return {active:true};
    }catch(error){workspaceReplacing=false;versionChanging=false;throw error;}
  },
  afterReplace:async(result,context)=>{
    if(!context?.active)return;
    const replacement=openWorkspace(workspace,root);
    ({workspace,dataDir,artifactDir,store}=replacement);cliPath=replacement.cli;
    viewer.resetSession();
    workspaceReplacing=false;versionChanging=false;
    sourceChanged({workspace,backupPath:result.backupPath,name:store.get().name,time:Date.now()});
  },
  replaceFailed:async (context,error)=>{
    if(!context?.active)return;
    try {
      if(error?.backupPath){
        workspaceRecoveryError=`작업 폴더 복구를 완료하지 못했습니다. 원본 백업은 ${error.backupPath} 에 보존되어 있습니다. 백업에서 복구한 뒤 서버를 다시 시작하세요.`;
        throw new Error(workspaceRecoveryError);
      }
      const restored=openWorkspace(workspace,root);
      ({workspace,dataDir,artifactDir,store}=restored);cliPath=restored.cli;
      viewer.resetSession();
      sourceChanged();
    } finally {workspaceReplacing=false;versionChanging=false;}
  },
});

app.get('/api/recipes', (req,res)=>res.json(listRecipes(workspace)));
app.get('/api/recipes/:id',(req,res)=>res.json(readRecipe(workspace,req.params.id)));
app.post('/api/recipes', (req,res)=>res.json(saveRecipe(workspace,req.body.recipe,{expectedHash:req.body.expectedHash})));
app.delete('/api/recipes/:id', (req,res)=>res.json(deleteRecipe(workspace,req.params.id,{expectedHash:req.body.expectedHash})));
app.post('/api/recipes/:id/launch', (req,res)=>{
  if(process.platform!=='win32')throw Error('Runs terminal requires Windows');
  const plan=planRecipeRun(workspace,req.params.id,{parameters:req.body.parameters,expectedHash:req.body.expectedHash});
  const sessionId=crypto.randomUUID();
  const directory=path.join(dataDir,'recipe-requests');
  fs.mkdirSync(directory,{recursive:true});
  const requestPath=path.join(directory,sessionId+'.json');
  fs.writeFileSync(requestPath,JSON.stringify({id:plan.recipeId,parameters:req.body.parameters,expectedHash:plan.recipeHash}),{flag:'wx'});
  const blockId=store.get().blocks[0]?.id;
  const dummy={readyState:WebSocket.CLOSED};
  try {
    startTerminal(dummy,{sessionId,agent:'shell',blockId},requestPath);
    sessions.get(sessionId).sockets.delete(dummy);
  } catch(error) { fs.unlinkSync(requestPath);throw error; }
  res.json({sessionId,agent:'shell',blockId});
});
installMcpSettings(app,()=>workspace,sessions);
interaction=installInteraction(app,()=>({workspace,env:{...process.env,ISP_API_URL:origin,ISP_API_TOKEN:token,ISP_CLI:cliPath,ISP_WORKSPACE:workspace,ISP_SOURCE_ROOT:sourceRoot(workspace)}}));
installPersonalAgentApi(app,{current:()=>({workspace,store,artifactDir}),interaction,authorize:authorized});
installAppUpdates(app,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version);
installProjectSkills(app,{current:()=>({workspace}),root});
const bundleOptions=z.object({excludedData:z.array(z.string().min(1).max(2000)).max(10000).optional(),includeImages:z.boolean().default(true),includeGit:z.boolean().default(false),includeVisualizations:z.boolean().default(true),artifactIds:z.array(z.string().min(1).max(100)).max(10000).optional(),includeViewer:z.boolean().default(true),includeData:z.boolean().default(true)});
app.get('/api/bundle/preview',async(req,res)=>{const options=bundleOptions.parse({...(typeof req.query.excludedData==='string'?{excludedData:JSON.parse(req.query.excludedData)}:{}),includeImages:req.query.includeImages!=='false',includeGit:req.query.includeGit==='true',includeVisualizations:req.query.includeVisualizations!=='false',includeViewer:req.query.includeViewer!=='false',includeData:req.query.includeData!=='false',...(typeof req.query.artifactIds==='string'?{artifactIds:req.query.artifactIds.split(',').filter(Boolean)}:{})});const {files,workspace:ignored,...plan}=await planBundle(workspace,options);res.json({...plan,downloadName:bundleFilename(store.get().name),files:files.map(({path,size})=>({path,size})),revision:store.get().revision});});
app.post('/api/bundle/preview',async(req,res)=>{const options=bundleOptions.parse(req.body);const {files,workspace:ignored,...plan}=await planBundle(workspace,options);res.json({...plan,downloadName:bundleFilename(store.get().name),files:files.map(({path,size})=>({path,size})),revision:store.get().revision});});
app.post('/api/bundle/export',async(req,res)=>{
 const options=bundleOptions.parse(req.body);if(req.body.revision!==undefined&&req.body.revision!==store.get().revision)return res.status(409).json({error:'프로젝트가 변경됐습니다. 목록을 새로 확인하세요.'});
 versionChanging=true;let temp;const downloadName=bundleFilename(store.get().name);
 try{temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-share-'));const result=await packBundle(workspace,path.join(temp,'workspace.bundle'),options);versionChanging=false;const cleanup=()=>fs.rm(temp,{recursive:true,force:true},()=>{});res.download(result.path,downloadName,cleanup);}
 catch(e){versionChanging=false;if(temp)fs.rmSync(temp,{recursive:true,force:true});throw e;}
});
app.get("/api/activity",(req,res)=>res.json(readActivity(dataDir)));
app.get("/api/versions/commits/:hash",async(req,res)=>res.json(await commitChanges(workspace,req.params.hash)));
app.post("/api/activity/summaries",(req,res)=>{
 const input=summarySchema.parse(req.body);
 recordActivity(dataDir,{...input,kind:"summary",title:input.title});
 res.status(201).json(readActivity(dataDir)[0]);
});


const harness=installHarness(app,{current:()=>({workspace,store}),interaction:()=>interaction.get(),broadcast:()=>broadcast()});
function broadcast() {
  const message = JSON.stringify({ type: "state", state: store.get() });
  for (const client of wss.clients)
    if (client.readyState === WebSocket.OPEN) client.send(message);
}
app.get("/api/bootstrap", (req, res) => {
  // Cookies ignore ports; each workspace server needs its own cookie name.
  res.cookie(`isp_${port}`, token, {
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

app.get('/api/graph',(req,res)=>res.json(diagramView(store.get(),req.query.diagramId||undefined)));
app.get('/api/diagrams',(req,res)=>{const p=store.get();res.json({revision:p.revision,selectedDiagramId:p.selectedDiagramId,diagrams:p.diagrams.map(d=>({...d,blockCount:p.blocks.filter(b=>b.diagramId===d.id).length}))});});
app.post('/api/diagrams',(req,res)=>{const state=store.diagram('create',req.body.diagram,req.body.revision);broadcast();res.json(state);});
app.patch('/api/diagrams/:id',(req,res)=>{const state=store.diagram('update',{...req.body.patch,id:req.params.id},req.body.revision);broadcast();res.json(state);});
app.delete('/api/diagrams/:id',(req,res)=>{const state=store.diagram('delete',{id:req.params.id},req.body.revision);broadcast();res.json(state);});
app.post('/api/diagrams/:id/select',(req,res)=>{const state=store.diagram('select',{id:req.params.id});broadcast();res.json(state);});
app.get("/api/project", (req, res) => res.json(store.get()));
app.post('/api/graph/operations',(req,res)=>{const result=applyGraphOperations(store,req.body);broadcast();res.json(result);});
app.get("/api/terminals", (req, res) => res.json(
  [...sessions].map(([sessionId, session]) => ({sessionId, agent: session.agent, blockId: session.blockId})),
));
app.delete("/api/terminals/:id", (req, res) => {
  if (versionChanging) throw new Error("버전 전환 중에는 터미널을 종료할 수 없습니다.");
  const id = z.string().uuid().parse(req.params.id);
  const session = sessions.get(id);
  if (session) stopTerminalSession(session);
  res.json({ok: true});
});
app.get("/api/workspace-info", (req, res) => res.json(workspaceInfo()));
app.post("/api/graph-check", async (req,res) => {
  const options=z.object({blockId:z.string().min(1).max(80).optional(),changedFiles:z.array(z.string().min(1).max(1000)).max(200).default([])}).strict().parse(req.body);
  const checkedWorkspace=workspace,project=store.get(),revision=project.revision;
  const report=await graphCheck(checkedWorkspace,project,options);
  res.json({...report,revision,stale:workspace!==checkedWorkspace||store.get().revision!==revision});
});
app.get("/api/tracking", async (req, res) => res.json(await listTracking(workspace, store.get())));
app.get("/api/checkpoints/compare", async (req, res) => res.json(await compareCheckpoints(workspace, req.query.from, req.query.to)));
app.get("/api/checkpoints/:id/preview", async (req, res) => res.json(await previewRestore(workspace, req.params.id)));
async function trackingMutation(res, action, status = 200) {
  if (demoRunning) return res.status(409).json({error: "실행 중인 예제가 끝난 뒤 작업 기록을 저장하세요."});
  versionChanging = true;
  try { res.status(status).json(await action()); }
  finally { versionChanging = false; }
}
app.post("/api/attempts", (req, res) => trackingMutation(res, () => createAttempt(workspace, store.get(), req.body), 201));
app.patch("/api/attempts/:id", (req, res) => trackingMutation(res, () => updateAttempt(workspace, store.get(), req.params.id, req.body)));
app.post("/api/attempts/:id/accept", (req, res) => trackingMutation(res, () => acceptAttempt(workspace, req.params.id)));
app.post("/api/checkpoints", (req, res) => trackingMutation(res, () => createCheckpoint(workspace, req.body), 201));
app.post("/api/checkpoints/:id/restore", (req, res) => {
  if(harness.busy())return res.status(409).json({error:"하네스를 중지한 뒤 복원하세요."});
  const input = z.object({snapshot:z.string().min(1), stopTerminals:z.literal(true)}).parse(req.body);
  return trackingMutation(res, async () => {
    const result = await restoreCheckpoint(workspace, {checkpointId:req.params.id, snapshot:input.snapshot}, stopTerminals);
    sourceChanged();
    return result;
  });
});
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
  if(harness.busy())return res.status(409).json({error:"하네스를 중지한 뒤 버전을 전환하세요."});
  const input = z
    .object({
      target: z.object({
        kind: z.enum(["branch", "commit", "tag"]),
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
    const result = await switchVersion(selectedWorkspace, input, stopTerminals);
    sourceChanged();
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
app.get('/api/workspaces',async(req,res)=>res.json(await listWorkspaces(workspace)));
app.post('/api/workspace/open',async(req,res)=>{
 const input=z.object({path:z.string().min(1)}).parse(req.body);
 const target=fs.realpathSync(input.path);
 if(target===workspace)return res.json({workspace,url:origin});
 res.json(await openWorkspaceServer(root,target));
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
      session.mcpCleanup?.();
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
  void mcpSharing.stop();
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
app.post('/api/graph-storage/migrate',(req,res)=>{
 if(req.body.revision!==store.get().revision)return res.status(409).json({error:'revision conflict'});
 res.json(store.migrate());
});
app.get('/api/blocks/:id/documents',(req,res)=>{
 if(!store.get().blocks.some(b=>b.id===req.params.id))return res.status(404).json({error:'Block not found'});
 const graphFile=workspaceInfo().graphFile,documents=blockDocuments(graphFile,req.params.id);
 if(req.query.path){const doc=documents.find(d=>d.path===req.query.path);if(!doc)return res.status(404).json({error:'Document not found'});const file=safeGraphPath(sourceRoot(workspace),doc.path);if(fs.statSync(file).size>1024*1024)return res.status(413).json({error:'Document exceeds 1MB'});return res.json({...doc,content:fs.readFileSync(file,'utf8')});}
 res.json({directory:blockStorageDirectory(graphFile,req.params.id),documents});
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
        block.implementationLine,
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
    { ...current.globalWork, userRequests: req.body.patch.userRequests ?? current.globalWork.userRequests },
    req.body.revision,
    req.body.patch.overview === undefined ? undefined : {...current.overview, ...req.body.patch.overview},
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
// Direct registration does not consume a memo or start implementation.
app.post(['/api/blocks/:id/jobs','/api/global/jobs'],(req,res)=>{
 const input=z.object({revision:z.number().int().positive(),title:z.string().trim().min(1).max(200),description:z.string().max(12000).default('')}).parse(req.body);
 const current=workState(store.get(),req),block=current.blocks.find(b=>b.id===req.params.id);
 if(!block)return res.status(404).json({error:'Block not found'});
 const job={id:crypto.randomUUID(),title:input.title,description:input.description,status:'pending',createdAt:new Date().toISOString(),resolution:''};
 const state=saveWork(req,{...current,blocks:current.blocks.map(b=>b.id===block.id?{...b,jobs:[...b.jobs,job]}:b)},input.revision);
 broadcast();res.status(201).json(state);
});
for(const mode of ['split','merge'])app.post([`/api/blocks/:id/jobs/${mode}`,`/api/global/jobs/${mode}`],(req,res)=>{
 const input=restructureSchema.parse(req.body),current=workState(store.get(),req),block=current.blocks.find(b=>b.id===req.params.id);
 if(!block)return res.status(404).json({error:'Block not found'});
 const replacement=restructureJobs(block,input,mode);
 const state=saveWork(req,{...current,blocks:current.blocks.map(b=>b.id===block.id?replacement:b)},input.revision);
 broadcast();res.json(state);
});
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
  if(new Set(presentation.blockIds.map(id=>state.blocks.find(b=>b.id===id)?.diagramId)).size>1)throw Error('Present one diagram at a time');
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
    {...(req.query.blockId||store.get().selectedBlockId?contextFor(store.get(), req.query.blockId || store.get().selectedBlockId):{...diagramView(store.get()),block:null}), paths: workspaceInfo(), blockDocumentation:(req.query.blockId||store.get().selectedBlockId)?{directory:blockStorageDirectory(workspaceInfo().graphFile,req.query.blockId||store.get().selectedBlockId),documents:blockDocuments(workspaceInfo().graphFile,req.query.blockId||store.get().selectedBlockId)}:null, projectSkills:listProjectSkills(workspace,root).filter(s=>!s.managed)},
  ),
);
app.get("/api/mermaid", (req, res) =>
  res.type("text/plain").send(toMermaid(diagramView(store.get(),req.query.diagramId||undefined))),
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
app.patch('/api/artifacts/:id',(req,res)=>{
  const artifact=updateArtifact(store,artifactDir,req.params.id,req.body);
  broadcast();
  res.json(artifact);
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
  if (!fs.existsSync(path.join(sourceRoot(workspace), "examples", "denoise.mjs")))
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
  if (workspaceReplacing || workspaceRecoveryError) return res.sendStatus(503);
  const cookies = (req.headers.cookie || "").split(";").map((s) => s.trim());
  if (!cookies.includes(`isp_${port}=${token}`) && !authorized(req))
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
function stopTerminalSession(session) {
  if(session.recipeRequest && process.platform==='win32') {
    execFile('taskkill.exe',['/PID',String(session.pty.pid),'/T','/F'],{windowsHide:true,timeout:5000},()=>{try{session.pty.kill();}catch{}});
  } else session.pty.kill();
}
function startTerminal(socket, message, recipeRequest) {
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
      ISP_WORKSPACE: workspace,
      ISP_SOURCE_ROOT: sourceRoot(workspace),
      PATH: `${path.dirname(cliPath)}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
      TERM: "xterm-256color",
    };
    if(recipeRequest)Object.assign(env,{ISP_RECIPE_REQUEST:recipeRequest,ISP_RECIPE_RUNNER:path.join(root,"scripts","recipe-terminal.mjs"),ISP_NODE:process.execPath,PYTHONUNBUFFERED:"1"});
    const windows = process.platform === "win32";
    const command = windows ? "cmd.exe" : process.env.SHELL || "/bin/bash";
    const args = windows && recipeRequest ? '/d /s /k ""%ISP_NODE%" "%ISP_RECIPE_RUNNER%""' : windows
      ? [
          "/d",
          "/k",
          agent === "shell"
            ? "echo ISP workspace ready. Run: isp context"
            : agent,
        ]
      : ["-i"];
    const mcp=agent==='shell'?null:prepareMcpLaunch(workspace,agent,sessionId,env);
    let processPty;
    try { processPty = pty.spawn(mcp?.launch?.command||command, mcp?.launch?.args||args, {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd: workspace,
      env,
    }); } catch(error) { mcp?.cleanup();throw error; }
    session = {
      pty: processPty,
      recipeRequest,
      mcpRevision:mcp?.revision??0,mcpNames:mcp?.names||[],mcpCleanup:mcp?.cleanup,
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
      terminal.mcpCleanup?.();
      if(terminal.recipeRequest)fs.unlink(terminal.recipeRequest,()=>{});
      sessions.delete(sessionId);
      for (const client of terminal.sockets)
        send(client, { type: "exit", exitCode });
    });
    if (!windows && !mcp?.launch)
      processPty.write(
        `function isp() { node "$ISP_CLI" "$@"; }\n${agent === "shell" ? "" : agent + "\n"}`,
      );
  }
  clearTimeout(session.timer);
  // One input owner: a refreshed/duplicated tab takes over without killing the PTY.
  for (const previous of session.sockets) {
    send(previous, { type: "detached" });
    previous.sessionId = null;
  }
  session.sockets.clear();
  session.sockets.add(socket);
  socket.sessionId = sessionId;
  send(socket, {
    type: "started",
    blockId: session.blockId,
    agent: session.agent,
    cols: session.pty.cols, rows: session.pty.rows, buffer: session.buffer,
  });
}
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, origin);
  if (url.pathname !== "/ws") return; // Vite HMR handles its own path.
  if (workspaceReplacing || workspaceRecoveryError) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }
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
      if (workspaceRecoveryError) throw new Error(workspaceRecoveryError);
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
      if (!session || !session.sockets.has(socket)) throw new Error("터미널을 먼저 시작하세요.");
      if (message.type === "input")
        session.pty.write(z.string().max(65536).parse(message.data));
      else if (message.type === "resize")
        session.pty.resize(
          z.number().int().min(2).max(500).parse(message.cols),
          z.number().int().min(2).max(300).parse(message.rows),
        );
      else if (message.type === "stop") stopTerminalSession(session);
    } catch (error) {
      console.error("Terminal request failed:", error.message);
      send(socket, { type: "error", error: error.message });
    }
  });
  socket.on("close", () => {
    const session = sessions.get(socket.sessionId);
    if (!session) return;
    session.sockets.delete(socket);
    // Browser disconnects do not end a shell or running agent. Stop/server shutdown does.
  });
});

// Unknown API routes must never fall through to the HTML application.
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint. Check that the server and UI versions match.'}));
// Serve the isolated, prebuilt chat surface in both production and Vite mode.
app.use('/cloudcli',express.static(path.join(root,'dist/cloudcli')));
app.use('/cloudcli',(_req,res)=>res.status(503).type('text').send('Interaction UI is not built. Run npm run build.'));
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
  await workspaceSearch.close();
  await mcpSharing.stop();
  await harness?.close();
  await interaction?.close();
  await reportSharing.stop();
  for (const session of sessions.values()) {
    clearTimeout(session.timer);
    if (process.platform === "win32") {
      await promisify(execFile)("taskkill.exe", ["/PID", String(session.pty.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => {});
    }
    try {
      session.pty.kill();
      session.mcpCleanup?.();
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
