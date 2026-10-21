import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {safeGraphPath} from './graph-storage.mjs';
import {validateGraph,diagramSchema} from './model.mjs';
import {harnessStep,harnessConfig,startHarness} from './harness-model.mjs';
import {runRecipe,planRecipeRun,readRecipe} from './recipes.mjs';
const active=['running','waiting','pausing'];
const now=()=>new Date().toISOString();
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounded=(value,max=1200)=>String(value||'').slice(0,max);
const conflict=message=>Object.assign(new Error(message),{status:409});
function atomic(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function resources(workspace,values=[]){return values.length?values.map(value=>{if(path.win32.isAbsolute(value)||value.includes(':'))throw Error('실행 범위는 워크스페이스 상대 경로여야 합니다.');const normalized=value.replaceAll('\\','/').replace(/\/$/,'');if(normalized==='.')return '.';safeGraphPath(workspace,normalized);return normalized.toLowerCase();}):['.'];}
function overlap(a,b){return a.some(x=>b.some(y=>x==='.'||y==='.'||x===y||x.startsWith(y+'/')||y.startsWith(x+'/')));}
export class Harness {
 constructor({workspace,store,interaction,executeRecipe=runRecipe}){
  Object.assign(this,{workspace,store,interaction,executeRecipe});this.controllers=new Map();this.tasks=new Map();this.runs=[];this.loadErrors=[];
  this.dir=safeGraphPath(workspace,'.isp/harness-runs');fs.mkdirSync(this.dir,{recursive:true});
  for(const name of fs.readdirSync(this.dir).filter(n=>n.endsWith('.json'))){
   try{const r=JSON.parse(fs.readFileSync(safeGraphPath(workspace,'.isp/harness-runs/'+name),'utf8'));
    z.string().uuid().parse(r.id);if(name!==r.id+'.json'||!r.definition?.blocks||!Array.isArray(r.attempts))throw Error('Invalid harness record');
    r.version=r.version||0;r.resources=r.resources||['.'];r.mode=r.mode||'automatic';r.definition.diagram.harness=harnessConfig.parse(r.definition.diagram.harness);for(const b of r.definition.blocks)b.harnessStep={...harnessStep.parse(b.harnessStep||{}),...(b.harnessStep?.recipeHash?{recipeHash:b.harnessStep.recipeHash}:{})};
    if(active.includes(r.status)){r.status='paused';r.pauseRequested=false;r.notice='서버가 재시작되었습니다. 이전 작업과 실행 중인 외부 프로세스를 확인한 뒤 재개하세요.';const a=r.attempts.at(-1);if(a?.status==='running'){a.status='interrupted';a.endedAt=now();a.error='Server restarted';}this.save(r);}
    this.runs.push(r);
   }catch(e){this.loadErrors.push({file:name,error:e.message});}
  }
  this.runs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }
 save(r){r.updatedAt=now();r.version=(r.version||0)+1;atomic(safeGraphPath(this.workspace,'.isp/harness-runs/'+r.id+'.json'),r);}
 list(){return this.runs.map(({definition,...r})=>{const b=definition.blocks.find(b=>b.id===r.currentStep);return {...r,currentStepName:b?.name||r.currentStep,phase:b?.harnessStep?.phase||'',limits:definition.diagram.harness,currentStepKind:b?.harnessStep?.kind,currentStepLimit:b?.harnessStep?.maxVisits||definition.diagram.harness.maxVisits};});}
 get(id){const r=this.runs.find(r=>r.id===id);if(!r)throw Error('Harness run not found');return r;}
 definition(id){
  const p=this.store.get(),source=p.diagrams.find(d=>d.id===id);if(source?.kind!=='harness')throw Error('Harness 다이어그램을 선택하세요.');
  const diagram=structuredClone(source);diagram.harness=harnessConfig.parse(diagram.harness);
  const blocks=p.blocks.filter(b=>b.diagramId===id).map(({userRequests,jobs,...b})=>({...structuredClone(b),harnessStep:harnessStep.parse(b.harnessStep||{})}));
  const ids=new Set(blocks.map(b=>b.id)),edges=structuredClone(p.edges.filter(e=>ids.has(e.source)));
  return {diagram,blocks,edges,entry:diagram.harness.entry||blocks[0]?.id||''};
 }
 inspect(id){
  const definition=this.definition(id),{blocks,edges,entry}=definition,errors=[],warnings=[],reachable=new Set();
  if(!blocks.length)errors.push('단계를 하나 이상 추가하세요.');
  if(!blocks.some(b=>b.id===entry))errors.push('시작 단계 ID가 없습니다.');
  const visit=id=>{if(reachable.has(id))return;reachable.add(id);edges.filter(e=>e.source===id).forEach(e=>visit(e.target));};if(entry)visit(entry);
  let locks;try{locks=resources(this.workspace,definition.diagram.harness.resources);}catch(e){errors.push(e.message);}
  for(const b of blocks){
   const step=b.harnessStep;
   if(!reachable.has(b.id)){warnings.push(`${b.name} (${b.id}): 시작 단계에서 도달하지 않습니다.`);continue;}
   if(!b.inputs.some(p=>p.id==='in'&&p.type==='signal')||!['pass','fail'].every(id=>b.outputs.some(p=>p.id===id&&p.type==='signal')))errors.push(`${b.id}: in / pass / fail 신호 포트가 필요합니다.`);
   if(step.kind==='agent'&&!step.prompt.trim())errors.push(`${b.id}: 에이전트 작업 지시가 비어 있습니다.`);
   if(step.kind==='run')try{planRecipeRun(this.workspace,step.recipeId,{parameters:Object.fromEntries(Object.entries(step.parameters).map(([k,v])=>[k,String(v)]))});step.recipeHash=readRecipe(this.workspace,step.recipeId).hash;}catch(e){errors.push(`${b.id}: ${e.message}`);}
   for(const skill of step.skills)try{if(path.win32.isAbsolute(skill)||skill.includes(':'))throw Error('워크스페이스 상대 경로가 필요합니다.');const file=safeGraphPath(this.workspace,skill);if(!fs.statSync(file).isFile())throw Error('파일이 아닙니다.');}catch{errors.push(`${b.id}: 스킬을 찾을 수 없습니다: ${skill}`);}
  }
  if(blocks.length&&!edges.some(e=>reachable.has(e.source))&&blocks.length>1)warnings.push('연결이 없어 시작 단계 이후 다른 단계는 실행되지 않습니다.');
  return {ok:!errors.length,errors,warnings,definition,resources:locks||['.'],revision:this.store.get().revision};
 }
 assertAvailable(r){if(this.closing)throw Error('서버가 종료 중입니다.');for(const other of this.runs){if(other.id===r.id)continue;if((active.includes(other.status)||this.controllers.has(other.id))&&overlap(r.resources||['.'],other.resources||['.']))throw conflict(`실행 범위가 겹칩니다: ${other.name} (${other.id}). 일시정지 또는 중지 후 진행하세요.`);}}
 start(raw){
  const input=startHarness.parse(raw);if(input.requestId){const existing=this.runs.find(r=>r.requestId===input.requestId);if(existing){if(existing.requestHash!==digest(input))throw conflict('같은 requestId에 다른 실행 요청을 사용할 수 없습니다.');return existing;}}
  if(input.revision!==undefined&&input.revision!==this.store.get().revision)throw conflict('revision conflict: 정의를 다시 확인하세요.');
  const check=this.inspect(input.diagramId);if(!check.ok)throw Error(check.errors.join('\n'));
  const p=this.store.get(),target=p.blocks.find(b=>b.id===input.targetBlockId);
  if(input.targetBlockId&&!target)throw Error('Target block not found');
  const targetDiagramId=input.targetDiagramId||target?.diagramId||'';
  if(targetDiagramId&&!p.diagrams.some(d=>d.id===targetDiagramId&&d.kind!=='harness'))throw Error('작업 대상은 Pipeline 다이어그램이어야 합니다.');
  if(target&&targetDiagramId!==target.diagramId)throw Error('작업 대상 블록과 다이어그램이 다릅니다.');
  const r={id:crypto.randomUUID(),...input,targetDiagramId,requestHash:digest(input),name:check.definition.diagram.name,resources:check.resources,definition:check.definition,definitionHash:digest(check.definition),currentStep:check.definition.entry,status:input.mode==='manual'?'paused':'running',attempts:[],createdAt:now(),version:0};
  this.assertAvailable(r);this.runs.push(r);this.save(r);if(r.status==='running')this.launch(r);return r;
 }
 limit(r){const b=r.definition.blocks.find(b=>b.id===r.currentStep);const visits=r.attempts.filter(a=>a.stepId===r.currentStep).length;const max=b?.harnessStep?.maxVisits||r.definition.diagram.harness.maxVisits;return r.attempts.length>=r.definition.diagram.harness.maxSteps?`전체 실행 한도 ${r.definition.diagram.harness.maxSteps}회에 도달했습니다. (Execution limit)` :visits>=max?`현재 단계 실행 한도 ${max}회에 도달했습니다. (Execution limit)`:'';}
 launch(r){
  if(this.controllers.has(r.id))return;const controller=new AbortController();this.controllers.set(r.id,controller);
  const task=this.execute(r,controller.signal).catch(e=>{r.status='paused';r.notice=e.message;const a=r.attempts.at(-1);if(a?.status==='running'){a.status='error';a.error=e.message;a.endedAt=now();}this.save(r);}).finally(()=>{this.controllers.delete(r.id);this.tasks.delete(r.id);if(r.status==='running'&&!this.closing)this.launch(r);});this.tasks.set(r.id,task);
 }
 context(r,b,attempt){
  const previous=r.attempts.slice(-5,-1).map(a=>({stepId:a.stepId,attemptId:a.id,status:a.status,chatId:a.chatId,result:a.result,error:a.error}));
  const context={runId:r.id,attemptId:attempt.id,definitionHash:r.definitionHash,target:{diagramId:r.targetDiagramId,blockId:r.targetBlockId},resources:r.resources,request:r.instruction,step:{id:b.id,name:b.name,...b.harnessStep},flow:r.definition.blocks.map(s=>({id:s.id,name:s.name,phase:s.harnessStep.phase,kind:s.harnessStep.kind})),transitions:r.definition.edges,previous};
  const relative=`.isp/harness-runs/${r.id}/${attempt.id}.context.json`,file=safeGraphPath(this.workspace,relative);fs.mkdirSync(path.dirname(file),{recursive:true});atomic(file,context);attempt.contextPath=relative;
  return `Execute one ISP Harness step. Run ID: ${r.id}; attempt ID: ${attempt.id}; step ID: ${b.id}; phase: ${b.harnessStep.phase||'(none)'}.\nRead the full execution context from ${JSON.stringify(file)} before working. It contains the task, acceptance conditions, skill paths, pinned target and recent evidence.\nPinned Pipeline ID: ${r.targetDiagramId||'(whole project)'}; block ID: ${r.targetBlockId||'(whole target)'}. Use explicit IDs, not UI selection.\nScope: ${JSON.stringify(r.resources)}. These are cooperative shared-folder scopes, not a filesystem sandbox. Stay within the declared scope; do not change unrelated work. Use the workspace CLI for managed graph changes.\nTask preview: ${bounded(b.harnessStep.prompt,1400)}\nRead the listed skills. Complete only this step; do not advance/approve harness gates or edit harness state files. Report changed files, evidence paths and limitations. Agent completion is not a test verdict. Full previous logs remain in the referenced run manifests/chats. Never read image bytes for display-only requests.`;
 }
 async agent(r,b,a,signal){
  const m=this.interaction(),step=b.harnessStep,text=this.context(r,b,a);this.save(r);
  const result=await m.send({provider:step.provider==='inherit'?r.provider:step.provider,text,blockId:r.targetBlockId,diagramId:r.targetDiagramId,harnessRunId:r.id});a.chatId=result.id;this.save(r);const deadline=Date.now()+step.timeoutSeconds*1000;
  while(true){const chat=m.chats.find(c=>c.id===result.id);
   if(signal.aborted||Date.now()>deadline){if(chat?.busy)await m.interrupt(result.id).catch(()=>{});if(chat){chat.queuePaused=true;chat.queue=[];await m.save();}throw Error(signal.aborted?'Stopped':'Step timed out');}
   if(!chat)throw Error('담당 채팅이 삭제되었습니다.');
   if(!chat.busy&&!chat.queue?.length){a.result={chatId:chat.id,status:chat.status,summary:bounded(chat.items.filter(i=>i.type==='agentMessage').at(-1)?.text,8000)};if(chat.status!=='completed')throw Error(`에이전트 실행 중단/오류: ${chat.status}`);return true;}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
 }
 async execute(r,signal){
  while(r.status==='running'&&!signal.aborted){
   const b=r.definition.blocks.find(b=>b.id===r.currentStep);if(!b)throw Error('Step missing from snapshot');const limit=this.limit(r);if(limit){r.status='paused';r.notice=limit;this.save(r);return;}
   const step=b.harnessStep,a={id:crypto.randomUUID(),stepId:b.id,name:b.name,phase:step.phase||'',visit:r.attempts.filter(a=>a.stepId===b.id).length+1,status:'running',startedAt:now()};r.attempts.push(a);r.staleSteps=(r.staleSteps||[]).filter(id=>id!==b.id);this.save(r);
   if(step.kind==='manual'){a.status='waiting';r.status='waiting';r.notice=step.prompt||'사용자 판정을 기다립니다.';this.save(r);return;}
   let passed;
   try{if(step.kind==='run'){const result=await this.executeRecipe(this.workspace,step.recipeId,{parameters:Object.fromEntries(Object.entries(step.parameters).map(([k,v])=>[k,String(v)])),timeoutMs:step.timeoutSeconds*1000,expectedHash:step.recipeHash},{signal});a.result={status:result.status,manifestPath:result.manifestPath,exitCode:result.exitCode,outputs:result.outputs};if(result.timedOut||result.status==='timed_out'||result.spawnError||result.cleanupError)throw Error(result.spawnError||result.cleanupError||'Run timed out');passed=result.status==='succeeded';}else passed=await this.agent(r,b,a,signal);
   }catch(e){a.error=e.message;a.status=signal.aborted?'interrupted':'error';a.endedAt=now();r.status=signal.aborted?'stopped':'paused';r.notice=signal.aborted?'작업이 중단되었습니다.':'실행 오류로 멈췄습니다. 원인을 확인한 뒤 현재 단계를 다시 실행하세요.';this.save(r);return;}
   a.endedAt=now();if(signal.aborted){a.status='interrupted';r.status='stopped';this.save(r);return;}
   if(step.review){a.status='waiting';a.proposedOutcome=passed?'pass':'fail';r.status='waiting';r.notice=`실행 결과: ${a.proposedOutcome}. 결과를 검토하고 판정하세요.`;this.save(r);return;}
   a.status=passed?'passed':'failed';this.advance(r,passed);this.save(r);
  }
 }
 advance(r,passed){
  const edge=r.definition.edges.find(e=>e.source===r.currentStep&&e.sourceHandle===(passed?'pass':'fail'));
  if(edge){const previous=r.attempts.findLastIndex(a=>a.stepId===edge.target);if(previous>=0)r.staleSteps=[...new Set([...(r.staleSteps||[]),...r.attempts.slice(previous).map(a=>a.stepId)])];r.lastEdgeId=edge.id;r.currentStep=edge.target;r.status=(r.mode==='manual'||r.pauseRequested)?'paused':'running';}else r.status=passed?'completed':'failed';
  r.notice='';r.pauseRequested=false;
 }
 async control(id,action,raw={}){
  const r=this.get(id);if(raw.version!==undefined&&raw.version!==r.version)throw conflict('실행 상태가 변경되었습니다. 새 상태를 확인하세요.');
  const note=z.string().max(8000).parse(raw.note||'');
  if(action==='pause'){if(r.status==='running'){r.pauseRequested=true;r.notice='현재 단계 완료 후 일시정지';}else if(r.status==='waiting')r.status='paused';else throw Error('진행 중인 실행만 일시정지할 수 있습니다.');}
  else if(action==='stop'){if(['completed','stopped','failed'].includes(r.status))throw Error('이미 종료된 실행입니다.');this.controllers.get(id)?.abort();r.status='stopped';r.pauseRequested=false;}
  else if(action==='mode'){if(this.controllers.has(id)||!['paused','waiting'].includes(r.status))throw Error('일시정지 후 모드를 변경하세요.');r.mode=z.enum(['automatic','manual']).parse(raw.mode);}
  else if(action==='resume'){
   if(!['paused','failed','stopped'].includes(r.status))throw Error('Run is not resumable');if(this.controllers.has(id))throw Error('Wait for the current process to stop');this.assertAvailable(r);
   const waiting=r.attempts.at(-1)?.status==='waiting';if(!waiting&&this.limit(r))throw Error(this.limit(r));
   r.status=waiting?'waiting':'running';r.notice='';r.pauseRequested=false;
  }else if(action==='pass'||action==='fail'){
   if(r.status!=='waiting')throw Error('No confirmation is pending');if(raw.attemptId&&raw.attemptId!==r.attempts.at(-1)?.id)throw conflict('확인 대상 단계가 변경되었습니다.');this.assertAvailable(r);
   const a=r.attempts.at(-1);a.status=action==='pass'?'passed':'failed';a.endedAt=now();a.note=note;this.advance(r,action==='pass');
  }else if(action==='record'){
   if(r.mode!=='manual'||r.status!=='paused'||this.controllers.has(id))throw Error('수동 모드의 대기 중인 단계에만 외부 결과를 기록할 수 있습니다.');this.assertAvailable(r);if(this.limit(r))throw Error(this.limit(r));if(!note.trim())throw Error('작업 결과와 근거를 입력하세요.');
   if(r.attempts.at(-1)?.status==='waiting')throw Error('진행 중인 사용자 확인 단계는 통과/실패로 판정하세요.');
   const outcome=z.enum(['pass','fail']).parse(raw.outcome),b=r.definition.blocks.find(b=>b.id===r.currentStep);
   r.attempts.push({id:crypto.randomUUID(),stepId:b.id,name:b.name,phase:b.harnessStep.phase||'',visit:r.attempts.filter(a=>a.stepId===b.id).length+1,status:outcome==='pass'?'passed':'failed',source:'external',note,startedAt:now(),endedAt:now()});r.staleSteps=(r.staleSteps||[]).filter(id=>id!==b.id);this.advance(r,outcome==='pass');
  }else throw Error('Unknown harness action');
  this.save(r);if(r.status==='running')this.launch(r);return r;
 }
 async close(){this.closing=true;const pending=this.runs.filter(r=>active.includes(r.status));for(const c of this.controllers.values())c.abort();await Promise.allSettled([...this.tasks.values()]);for(const r of pending){r.status='paused';r.notice='서버가 종료되었습니다. 기존 작업을 확인한 뒤 재개하세요.';this.save(r);}}
}
export function installHarness(app,{current,interaction,broadcast}){
 let manager;const get=()=>{const c=current();if(!manager||manager.workspace!==c.workspace||manager.store!==c.store){void manager?.close();manager=new Harness({...c,interaction});}return manager;};
 app.get('/api/harness/runs',(_req,res)=>res.json(get().list()));
 app.get('/api/harness/diagnostics',(_req,res)=>res.json({loadErrors:get().loadErrors}));
 app.get('/api/harness/runs/:id',(req,res)=>res.json(get().get(req.params.id)));
 app.get('/api/harness/check/:id',(req,res)=>{const {definition,...check}=get().inspect(req.params.id);res.json({...check,steps:definition.blocks.map(b=>({id:b.id,name:b.name,kind:b.harnessStep.kind,phase:b.harnessStep.phase})),entry:definition.entry});});
 app.post('/api/harness/runs',(req,res)=>res.json(get().start(req.body)));
 app.post('/api/harness/runs/:id/:action',async(req,res)=>res.json(await get().control(req.params.id,req.params.action,req.body)));
 app.post('/api/harness/steps/:id',(req,res)=>{
  const {store}=current(),p=store.get(),b=p.blocks.find(b=>b.id===req.params.id);if(!b||p.diagrams.find(d=>d.id===b.diagramId)?.kind!=='harness')throw Error('Harness step not found');
  const patch=z.object({name:z.string().trim().min(1).max(100),description:z.string().max(12000),harnessStep,pass:z.string(),fail:z.string()}).parse(req.body.step);
  const {pass,fail,...fields}=patch;const edges=p.edges.filter(e=>e.source!==b.id);
  for(const [outcome,target] of [['pass',pass],['fail',fail]])if(target){const other=p.blocks.find(x=>x.id===target&&x.diagramId===b.diagramId);if(!other?.inputs.some(x=>x.id==='in'))throw Error('같은 하네스의 유효한 단계 ID를 선택하세요.');const old=p.edges.find(e=>e.source===b.id&&e.sourceHandle===outcome);edges.push({id:old?.id||'edge-'+crypto.randomUUID().slice(0,8),source:b.id,sourceHandle:outcome,target,targetHandle:'in'});}
  store.graph(validateGraph({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,...fields}:x),edges}),req.body.revision);broadcast();res.json({revision:store.get().revision});
 });
 app.get('/api/harness/export/:id',(req,res)=>{const definition=get().definition(req.params.id);res.json({format:'isp-harness',version:1,definition,requirements:{recipes:[...new Set(definition.blocks.filter(b=>b.harnessStep.kind==='run').map(b=>b.harnessStep.recipeId))],skills:[...new Set(definition.blocks.flatMap(b=>b.harnessStep.skills))]}});});
 app.post('/api/harness/import',(req,res)=>{
  const {store}=current(),p=store.get(),bundle=req.body.bundle;if(req.body.revision!==p.revision)throw conflict('revision conflict');if(bundle?.format!=='isp-harness'||bundle.version!==1)throw Error('Unsupported harness bundle');
  const d=bundle.definition;if(!Array.isArray(d?.blocks)||!d.blocks.length||d.blocks.length>200||new Set(d.blocks.map(b=>b.id)).size!==d.blocks.length)throw Error('Invalid harness blocks');
  const id='harness-'+crypto.randomUUID().slice(0,8),ids=new Map(d.blocks.map(b=>[b.id,'step-'+crypto.randomUUID().slice(0,8)]));if(d.entry&&!ids.has(d.entry))throw Error('Invalid entry step');
  const diagram=diagramSchema.parse({...d.diagram,id,kind:'harness',harness:{...d.diagram.harness,entry:ids.get(d.entry)||''}}),blocks=d.blocks.map(b=>({...b,id:ids.get(b.id),diagramId:id,userRequests:[],jobs:[]})),edges=d.edges.map(e=>({...e,id:'edge-'+crypto.randomUUID().slice(0,8),source:ids.get(e.source),target:ids.get(e.target)}));
  const next=validateGraph({...p,diagrams:[...p.diagrams,diagram],blocks:[...p.blocks,...blocks],edges:[...p.edges,...edges]});store.graph(next,p.revision);broadcast();res.json({diagramId:id,requirements:bundle.requirements,notice:'정의만 가져왔습니다. 스킬·Run·실행 범위를 검토하세요.'});
 });
 return {busy:()=>!!manager&&(manager.controllers.size>0||manager.runs.some(r=>active.includes(r.status))),close:()=>manager?.close()};
}
