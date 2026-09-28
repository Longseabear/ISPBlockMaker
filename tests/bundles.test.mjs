import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {packBundle,unpackBundle,planBundle,inspectBundle,previewBundleDestination} from '../server/bundles.mjs';
import {writeZip,openZip,sha256} from '../server/bundle-zip.mjs';
import {createCheckpoint,listTracking} from '../server/tracking.mjs';
const graph={name:'Shared test',blocks:[{id:'input',name:'Input',description:'sample',principle:'',implementation:'blocks/input.py',status:'draft',inputs:[],outputs:[],parameters:{},position:{x:0,y:0}}],edges:[]};
async function fixture(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'isp-bundle-test-'));const workspace=path.join(temp,'source');await fs.mkdir(workspace);const write=async(p,data)=>{await fs.mkdir(path.dirname(path.join(workspace,p)),{recursive:true});await fs.writeFile(path.join(workspace,p),data);};await write('graph.json',JSON.stringify(graph));await write('blocks/input.py','def process(image):\n    return image\n');await write('.isp/project.json',JSON.stringify({storageVersion:2,revision:1,selectedBlockId:'input',blocks:[{id:'input',userRequests:[],jobs:[]}],artifacts:[]}));await write('.isp/artifacts/result.html','<h1>Result</h1>');await write('.isp/viewer/source.bin',Buffer.from([1,2,3,4]));await write('.isp/viewer/results/crop.raw',Buffer.from([3,4]));for(const name of ['.isp/connection.json','.isp/tools/isp.mjs','.env','.env.local','.claude/settings.local.json','node_modules/lib/index.js','.venv/pyvenv.cfg','tmp/job/intermediate.raw'])await write(name,'PRIVATE');return {temp,workspace,write};}
const clean=t=>fs.rm(t,{recursive:true,force:true});
async function separatedFixture(){
 const f=await fixture(),project=path.join(f.workspace,'project');await fs.mkdir(project);
 await fs.rename(path.join(f.workspace,'graph.json'),path.join(project,'graph.json'));
 await fs.rename(path.join(f.workspace,'blocks'),path.join(project,'blocks'));
 await f.write('.isp/workspace.json',JSON.stringify({version:1,sourceRoot:'project'}));
 await f.write('data/source.raw',Buffer.from([5,6,7,8]));
 await f.write('project/tmp/intermediate.raw','PRIVATE');
 await f.write('project/.isp/connection.json','PRIVATE');
 return {...f,project};
}
async function rewriteManifest(input,output,change){
 const zip=await openZip(input);
 try{const items=[];for(const entry of zip.entries){let data=await zip.read(entry);if(entry.path==='isp-bundle.json'){const manifest=JSON.parse(data);change(manifest);data=Buffer.from(JSON.stringify(manifest));}items.push({path:entry.path,data});}await writeZip(output,items);}finally{await zip.close();}
}
test('Bundle round-trip preserves graph, code, results and crop bytes while excluding local state and secrets',async()=>{const f=await fixture();try{const plan=await planBundle(f.workspace);assert.equal(plan.fileCount,6);const output=path.join(f.temp,'work.bundle');await packBundle(f.workspace,output);const target=path.join(f.temp,'restored');await unpackBundle(output,target);assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'graph.json'))),graph);assert.deepEqual(await fs.readFile(path.join(target,'.isp/viewer/results/crop.raw')),Buffer.from([3,4]));assert.equal(await fs.readFile(path.join(target,'.isp/artifacts/result.html'),'utf8'),'<h1>Result</h1>');await assert.rejects(()=>fs.stat(path.join(target,'.isp/connection.json')));await assert.rejects(()=>unpackBundle(output,target),/already exists/);await assert.rejects(()=>packBundle(f.workspace,output),/already exists/);const small=path.join(f.temp,'small.bundle');await packBundle(f.workspace,small,{includeImages:false});await unpackBundle(small,path.join(f.temp,'small'));await assert.rejects(()=>fs.stat(path.join(f.temp,'small/.isp/viewer/source.bin')));assert.deepEqual(await fs.readFile(path.join(f.temp,'small/.isp/viewer/results/crop.raw')),Buffer.from([3,4]));}finally{await clean(f.temp);}});
test('Bundle rejects corrupt bytes, forbidden files, traversal names and unsupported manifests without leaving a destination',async()=>{const f=await fixture();try{const output=path.join(f.temp,'work.bundle');await packBundle(f.workspace,output);const zip=await openZip(output),e=zip.entries.find(e=>e.path==='blocks/input.py');await zip.close();const bytes=await fs.readFile(output);bytes[e.start]^=1;await fs.writeFile(path.join(f.temp,'bad.bundle'),bytes);const dest=path.join(f.temp,'rejected');await assert.rejects(()=>unpackBundle(path.join(f.temp,'bad.bundle'),dest),/checksum/);await assert.rejects(()=>fs.stat(dest));for(const version of [1,999]){const data=Buffer.from('PRIVATE'),manifest={format:'isp-block-maker-bundle',version,files:[{path:'.env',size:data.length,sha256:sha256(data)}]};await writeZip(path.join(f.temp,'secret'+version+'.bundle'),[{path:'.env',data},{path:'isp-bundle.json',data:Buffer.from(JSON.stringify(manifest))}]);await assert.rejects(()=>unpackBundle(path.join(f.temp,'secret'+version+'.bundle'),dest),/forbidden|Unsupported/);}const traversal=Buffer.from(await fs.readFile(output));for(let pos=traversal.indexOf('blocks/input.py');pos>=0;pos=traversal.indexOf('blocks/input.py',pos+15))traversal.write('../bad/input.py',pos);await fs.writeFile(path.join(f.temp,'traversal.bundle'),traversal);await assert.rejects(()=>unpackBundle(path.join(f.temp,'traversal.bundle'),dest),/Unsafe/);await assert.rejects(()=>fs.stat(dest));}finally{await clean(f.temp);}});
test('Optional Git bundle restores branches, HEAD and uncommitted work without copying hooks or remotes',async()=>{const f=await fixture();const git=args=>execFileSync('git',args,{cwd:f.workspace,encoding:'utf8',windowsHide:true});try{git(['init','-b','main']);git(['add','graph.json','blocks/input.py']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','First implementation']);git(['branch','candidate']);const head=git(['rev-parse','HEAD']).trim();await f.write('blocks/input.py','# uncommitted\n');const out=path.join(f.temp,'git.bundle');await packBundle(f.workspace,out,{includeGit:true});const dest=path.join(f.temp,'restored');await unpackBundle(out,dest);assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:dest,encoding:'utf8',windowsHide:true}).trim(),head);assert.equal(await fs.readFile(path.join(dest,'blocks/input.py'),'utf8'),'# uncommitted\n');assert.match(execFileSync('git',['branch'],{cwd:dest,encoding:'utf8',windowsHide:true}),/candidate/);assert.match(execFileSync('git',['status','--porcelain'],{cwd:dest,encoding:'utf8',windowsHide:true}),/ M blocks\/input.py/);}finally{await clean(f.temp);}});

test('Separated project bundles preserve tracking, dirty source and checkpoint refs with optional Git history',async()=>{
 const f=await separatedFixture();
 const git=(args,cwd=f.project)=>execFileSync('git',['-c','core.autocrlf=false','-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd,encoding:'utf8',windowsHide:true}).trim();
 try{
  git(['init','-b','main']);git(['add','graph.json','blocks/input.py']);git(['commit','-m','Baseline']);
  const head=git(['rev-parse','HEAD']);git(['tag','accepted']);
  await f.write('project/blocks/input.py','# checkpoint implementation\n');git(['add','blocks/input.py']);
  const indexTreeHash=git(['write-tree']),indexCommitHash=git(['commit-tree',indexTreeHash,'-p',head,'-m','Staged snapshot']);
  await f.write('project/blocks/input.py','# checkpoint unstaged implementation\n');git(['add','blocks/input.py']);
  const treeHash=git(['write-tree']),hash=git(['commit-tree',treeHash,'-p',head,'-p',indexCommitHash,'-m','Named checkpoint']);
  const checkpoint={id:'checkpoint-test',title:'Try max-min',hash,treeHash,indexTreeHash,indexCommitHash,createdAt:new Date().toISOString(),kind:'manual',sourceHead:head,sourceBranch:'main'};
  git(['update-ref','refs/isp/checkpoints/'+checkpoint.id,hash]);git(['reset','--mixed',head]);
  await f.write('project/blocks/input.py','# current uncommitted implementation\n');
  await f.write('project/recovery-only.py','# untracked recovery content\n');
  git(['stash','push','--include-untracked','-m','Safety recovery']);
  const recoveryHash=git(['rev-parse','refs/stash']);git(['update-ref','refs/isp/recovery/'+checkpoint.id,recoveryHash]);git(['stash','pop']);
  checkpoint.recoveryStashHash=recoveryHash;
  const tracking={schemaVersion:1,attempts:[{id:'attempt-test',title:'Improve flat detection',status:'completed',jobIds:['job-test'],blockIds:['input'],artifactIds:[],resultCheckpointId:checkpoint.id}],checkpoints:[checkpoint],acceptedAttemptId:'attempt-test',lastAttemptId:'attempt-test'};
  await f.write('.isp/tracking.json',JSON.stringify(tracking));
  for(const includeGit of [false,true]){
   const bundle=path.join(f.temp,includeGit?'history.bundle':'results.bundle'),target=path.join(f.temp,includeGit?'with-history':'without-history');
   const packed=await packBundle(f.workspace,bundle,{includeGit});
   assert.equal(packed.manifest.version,2);assert.equal(packed.manifest.sourceRoot,'project');
   await unpackBundle(bundle,target);
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'.isp/tracking.json'))),tracking);
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'project/graph.json'))),graph);
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'.isp/workspace.json'))),{version:1,sourceRoot:'project'});
   assert.equal(await fs.readFile(path.join(target,'project/blocks/input.py'),'utf8'),'# current uncommitted implementation\n');
   assert.deepEqual(await fs.readFile(path.join(target,'data/source.raw')),Buffer.from([5,6,7,8]));
   const tracked=await listTracking(target,graph);assert.equal(tracked.checkpoints[0].available,includeGit);
   for(const excluded of ['.git','graph.json','project/tmp/intermediate.raw','project/.isp/connection.json','.isp/connection.json','.isp/history.gitbundle'])await assert.rejects(()=>fs.stat(path.join(target,excluded)));
   const restored=path.join(target,'project');
   if(includeGit){
    assert.equal(git(['rev-parse','HEAD'],restored),head);
    assert.equal(git(['rev-parse','refs/isp/checkpoints/'+checkpoint.id],restored),hash);
    assert.equal(git(['rev-parse','refs/isp/recovery/'+checkpoint.id],restored),recoveryHash);
    assert.equal(git(['cat-file','-p',recoveryHash+'^3:recovery-only.py'],restored),'# untracked recovery content');
    assert.equal(git(['rev-parse','refs/tags/accepted'],restored),head);
    assert.equal(git(['cat-file','-p',indexCommitHash+':blocks/input.py'],restored),'# checkpoint implementation');
    assert.match(git(['status','--porcelain'],restored),/M blocks\/input.py/);
   }else await assert.rejects(()=>fs.stat(path.join(restored,'.git')));
  }
 }finally{await clean(f.temp);}
});

test('Legacy version-one bundles stay readable and invalid source roots cannot redirect extraction',async()=>{
 const f=await fixture();try{
  const original=path.join(f.temp,'original.bundle');await packBundle(f.workspace,original);
  const legacy=path.join(f.temp,'legacy.bundle');await rewriteManifest(original,legacy,manifest=>{manifest.version=1;delete manifest.sourceRoot;});
  const restored=path.join(f.temp,'legacy');await unpackBundle(legacy,restored);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(restored,'graph.json'))),graph);
  for(const [index,source] of ['../outside','C:/outside','.isp','project'].entries()){
   const invalid=path.join(f.temp,'invalid-'+index+'.bundle'),destination=path.join(f.temp,'rejected-'+index);
   await rewriteManifest(original,invalid,manifest=>{manifest.sourceRoot=source;});
   await assert.rejects(()=>unpackBundle(invalid,destination),/source root|no project\/graph.json/);
   await assert.rejects(()=>fs.stat(destination));
  }
 }finally{await clean(f.temp);}
});

test('Git history export supports new projects and checkpoints before the first branch commit',async()=>{
 const f=await separatedFixture();try{
  execFileSync('git',['init','-b','main'],{cwd:f.project,windowsHide:true});
  for(const withCheckpoint of [false,true]){
   const checkpoint=withCheckpoint?await createCheckpoint(f.workspace,{title:'First attempt baseline'}):null;
   const output=path.join(f.temp,withCheckpoint?'checkpoint.bundle':'empty.bundle'),target=path.join(f.temp,withCheckpoint?'checkpoint-restored':'empty-restored');
   const packed=await packBundle(f.workspace,output,{includeGit:true});
   assert.equal(packed.manifest.history.head,null);assert.equal(packed.manifest.history.empty,!withCheckpoint);
   await unpackBundle(output,target);
   assert.equal(execFileSync('git',['symbolic-ref','--short','HEAD'],{cwd:path.join(target,'project'),encoding:'utf8',windowsHide:true}).trim(),'main');
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'project/graph.json'))),graph);
   const state=await listTracking(target,graph);
   if(checkpoint){assert.equal(state.checkpoints[0].id,checkpoint.id);assert.equal(state.checkpoints[0].available,true);}
   else assert.equal(state.checkpoints.length,0);
   assert.equal(state.current.headHash,null);
  }
 }finally{await clean(f.temp);}
});
test('CLI restores into a new folder and regenerates workspace-local agent tools without launching',async()=>{const f=await fixture();try{const out=path.join(f.temp,'cli.bundle');execFileSync(process.execPath,[path.resolve('scripts/workspace-cli.mjs'),'pack',f.workspace,'-o',out],{windowsHide:true});const dest=path.join(f.temp,'restored');const result=execFileSync(process.execPath,[path.resolve('scripts/workspace-cli.mjs'),'open',out,'--into',dest,'--no-open'],{encoding:'utf8',windowsHide:true});assert.match(result,/Bundle restored/);assert.match(await fs.readFile(path.join(dest,'.isp/tools/isp.mjs'),'utf8'),/ISP_CANONICAL|workspace/);assert.match(await fs.readFile(path.join(dest,'.agents/skills/isp-block-maker/SKILL.md'),'utf8'),/temporary-files.md/);assert.match(await fs.readFile(path.join(dest,'project/.gitignore'),'utf8'),/\/tmp\//);}finally{await clean(f.temp);}});

test('Selecting project/ exports its workspace, selected visualization bytes and consistent filtered records',async()=>{
 const f=await separatedFixture();try{
  const records=JSON.parse(await fs.readFile(path.join(f.workspace,'.isp/project.json')));
  records.artifacts=[{id:'first',title:'WB comparison',kind:'html',file:'result.html',blockId:'input'},{id:'second',title:'Private debug',kind:'html',file:'other.html',blockId:'input'}];
  await f.write('.isp/project.json',JSON.stringify(records));await f.write('.isp/artifacts/other.html','<h1>Private debug</h1>');
  await f.write('unrelated.raw','DO NOT SHARE');
  const tracking={schemaVersion:1,attempts:[{id:'attempt',artifactIds:['first','second']}],checkpoints:[]};await f.write('.isp/tracking.json',JSON.stringify(tracking));
  const options={artifactIds:['first'],includeViewer:false,includeData:false},plan=await planBundle(f.project,options);
  assert.equal(plan.workspace,f.workspace);assert.equal(plan.availableArtifacts.length,2);assert.deepEqual(plan.selectedArtifactIds,['first']);
  assert.ok(!plan.files.some(file=>/viewer\/|data\/|unrelated.raw|other.html/.test(file.path)));
  const output=path.join(f.temp,'selected.bundle'),packed=await packBundle(f.project,output,options),target=path.join(f.temp,'selected');
  assert.deepEqual(packed.manifest.files.map(({path,size})=>({path,size})),plan.files.map(({path,size})=>({path,size})));
  const info=await inspectBundle(output);assert.equal(info.artifactCount,1);assert.equal(info.includeViewer,false);assert.equal(info.includeData,false);
  await unpackBundle(output,target);
  const imported=JSON.parse(await fs.readFile(path.join(target,'.isp/project.json')));assert.deepEqual(imported.artifacts,[records.artifacts[0]]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'.isp/tracking.json'))),tracking,'historical links remain recorded even if a visualization is omitted');
  for(const missing of ['.isp/viewer','.isp/artifacts/other.html','data','unrelated.raw'])await assert.rejects(()=>fs.stat(path.join(target,missing)));
  for(const [name,options] of [['none',{includeVisualizations:false}],['empty-selection',{artifactIds:[]}]]){
   const file=path.join(f.temp,name+'.bundle'),dest=path.join(f.temp,name);await packBundle(f.workspace,file,options);await unpackBundle(file,dest);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dest,'.isp/project.json'))).artifacts,[]);await assert.rejects(()=>fs.stat(path.join(dest,'.isp/artifacts/result.html')));
  }
  await assert.rejects(()=>planBundle(f.workspace,{artifactIds:['missing']}),/Unknown visualization/);
 }finally{await clean(f.temp);}
});

test('Overwrite import preserves the entire old workspace in a sibling backup and rejects stale previews',async()=>{
 const f=await separatedFixture();try{
  const file=path.join(f.temp,'source.bundle');await packBundle(f.workspace,file,{includeViewer:false});
  const destination=path.join(f.temp,'destination');await fs.mkdir(destination);await fs.writeFile(path.join(destination,'graph.json'),JSON.stringify({...graph,name:'Old project'}));await fs.writeFile(path.join(destination,'notes.txt'),'irreplaceable notes');
  const preview=await previewBundleDestination(destination,{mode:'overwrite'});assert.equal(preview.name,'Old project');assert.equal(preview.backupRequired,true);
  await fs.writeFile(path.join(destination,'notes.txt'),'updated notes');
  await assert.rejects(()=>unpackBundle(file,destination,{mode:'overwrite',destinationSnapshot:preview.snapshot}),/변경/);
  assert.equal(await fs.readFile(path.join(destination,'notes.txt'),'utf8'),'updated notes');
  const fresh=await previewBundleDestination(destination,{mode:'overwrite'}),result=await unpackBundle(file,destination,{mode:'overwrite',destinationSnapshot:fresh.snapshot});
  assert.equal(path.dirname(result.backupPath),f.temp);assert.ok(path.basename(result.backupPath).startsWith('destination.backup-'));
  assert.equal(await fs.readFile(path.join(result.backupPath,'notes.txt'),'utf8'),'updated notes');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backupPath,'graph.json'))).name,'Old project');
  assert.equal(JSON.parse(await fs.readFile(path.join(destination,'project/graph.json'))).name,graph.name);
  await assert.rejects(()=>fs.stat(path.join(destination,'notes.txt')));
  const unrelated=path.join(f.temp,'unrelated');await fs.mkdir(unrelated);await fs.writeFile(path.join(unrelated,'valuable.txt'),'keep');
  await assert.rejects(()=>unpackBundle(file,unrelated,{mode:'overwrite'}));assert.equal(await fs.readFile(path.join(unrelated,'valuable.txt'),'utf8'),'keep');
  await assert.rejects(()=>previewBundleDestination(f.workspace,{mode:'overwrite',protectedPaths:[f.project]}),/덮어쓸/);
 }finally{await clean(f.temp);}
});

test('Corrupt archives never stop or replace a workspace; finalization failures roll back the folder swap',async()=>{
 const f=await fixture();try{
  const input=path.join(f.temp,'source.bundle');await packBundle(f.workspace,input);
  const destination=path.join(f.temp,'destination');await fs.mkdir(destination);await fs.writeFile(path.join(destination,'graph.json'),JSON.stringify({...graph,name:'Preserved'}));await fs.writeFile(path.join(destination,'original.txt'),'original');
  const corrupt=path.join(f.temp,'corrupt.bundle');await fs.writeFile(corrupt,'invalid bytes');let stopped=0,rolledBack=0;
  await assert.rejects(()=>unpackBundle(corrupt,destination,{mode:'overwrite',beforeReplace:async()=>{stopped++;}}));assert.equal(stopped,0);
  await assert.rejects(()=>unpackBundle(input,destination,{mode:'overwrite',beforeReplace:async()=>{stopped++;return {handle:'original'};},afterReplace:async()=>{throw new Error('reopen failed');},replaceFailed:async(context)=>{assert.equal(context.handle,'original');rolledBack++;}}),/reopen failed/);
  assert.equal(stopped,1);assert.equal(rolledBack,1);assert.equal(await fs.readFile(path.join(destination,'original.txt'),'utf8'),'original');assert.equal(JSON.parse(await fs.readFile(path.join(destination,'graph.json'))).name,'Preserved');
  assert.ok(!(await fs.readdir(f.temp)).some(name=>name.startsWith('destination.backup-')||name.startsWith('.isp-unpack-')));
  // A late write after terminal shutdown must also leave the original folder in place.
  await assert.rejects(()=>unpackBundle(input,destination,{mode:'overwrite',beforeReplace:async()=>{await fs.writeFile(path.join(destination,'original.txt'),'late write');return {};},replaceFailed:async()=>{rolledBack++;}}),/변경/);
  assert.equal(await fs.readFile(path.join(destination,'original.txt'),'utf8'),'late write');assert.equal(rolledBack,2);
 }finally{await clean(f.temp);}
});

test('CLI explicit overwrite retains a recoverable backup and regenerates final absolute tool paths',async()=>{
 const f=await fixture();try{
  const input=path.join(f.temp,'cli.bundle');await packBundle(f.workspace,input);
  const destination=path.join(f.temp,'old');await fs.mkdir(destination);await fs.writeFile(path.join(destination,'graph.json'),JSON.stringify({...graph,name:'Old'}));await fs.writeFile(path.join(destination,'keep.txt'),'keep');
  assert.throws(()=>execFileSync(process.execPath,[path.resolve('scripts/workspace-cli.mjs'),'open',input,'--into',destination,'--no-open'],{windowsHide:true,stdio:'pipe'}),/Destination already exists/);
  const text=execFileSync(process.execPath,[path.resolve('scripts/workspace-cli.mjs'),'open',input,'--into',destination,'--overwrite','--no-open'],{windowsHide:true,encoding:'utf8'});
  assert.match(text,/Original workspace backup:/);const backup=text.split('Original workspace backup: ')[1].trim();assert.equal(await fs.readFile(path.join(backup,'keep.txt'),'utf8'),'keep');
  const bridge=await fs.readFile(path.join(destination,'.isp/tools/isp.mjs'),'utf8');assert.ok(bridge.includes(JSON.stringify(destination)));assert.ok(!bridge.includes('.isp-unpack-'));
  assert.equal(JSON.parse(await fs.readFile(path.join(destination,'.isp/layout-migrated.json'))).workspace,destination);
  assert.equal(JSON.parse(await fs.readFile(path.join(destination,'project/graph.json'))).name,graph.name);
 }finally{await clean(f.temp);}
});

test('Overwrite snapshot ignores live rendering and Git read caches but detects staging and durable work',async()=>{
 const f=await separatedFixture();try{
  const git=args=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:f.project,encoding:'utf8',windowsHide:true});
  git(['init','-b','main']);git(['add','graph.json','blocks/input.py']);git(['commit','-m','Baseline']);
  await f.write('project/blocks/input.py','# dirty working source\n');
  const baseline=await previewBundleDestination(f.workspace,{mode:'overwrite'});
  await f.write('.isp/viewer/current-view.png','new rendered pixels');await f.write('.isp/viewer/current-view.png.tmp','render in progress');await f.write('project/.git/isp-index-12345678-1234-1234-1234-123456789abc','temporary index');
  await listTracking(f.workspace,graph);
  assert.equal((await previewBundleDestination(f.workspace,{mode:'overwrite'})).snapshot,baseline.snapshot);
  git(['add','blocks/input.py']);assert.notEqual((await previewBundleDestination(f.workspace,{mode:'overwrite'})).snapshot,baseline.snapshot);
  const staged=await previewBundleDestination(f.workspace,{mode:'overwrite'});await f.write('.isp/viewer/requests.json','[]');assert.notEqual((await previewBundleDestination(f.workspace,{mode:'overwrite'})).snapshot,staged.snapshot);
 }finally{await clean(f.temp);}
});

test('Import refuses linked destination ancestors before touching the real target',async()=>{
 const f=await fixture();try{
  const alias=path.join(f.temp,'alias');await fs.symlink(f.workspace,alias,process.platform==='win32'?'junction':'dir');
  const input=path.join(f.temp,'source.bundle');await packBundle(f.workspace,input);
  await assert.rejects(()=>unpackBundle(input,alias,{mode:'overwrite'}),/linked/);
  await assert.rejects(()=>unpackBundle(input,path.join(alias,'child')),/linked/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.workspace,'graph.json'))).name,graph.name);
 }finally{await clean(f.temp);}
});

test('Two concurrent imports cannot replace the same destination behind a valid preview',async()=>{
 const f=await fixture();try{
  const input=path.join(f.temp,'source.bundle');await packBundle(f.workspace,input);
  const destination=path.join(f.temp,'destination');await fs.mkdir(destination);await fs.writeFile(path.join(destination,'graph.json'),JSON.stringify(graph));
  let ready,release;const held=new Promise(resolve=>{release=resolve;}),prepared=new Promise(resolve=>{ready=resolve;});
  const first=unpackBundle(input,destination,{mode:'overwrite',prepare:async()=>{ready();await held;}});await prepared;
  try{await assert.rejects(()=>unpackBundle(input,destination,{mode:'overwrite'}),/복원 중/);}finally{release();}
  const result=await first;assert.ok(result.backupPath);assert.equal((await fs.readdir(f.temp)).filter(name=>name.startsWith('destination.backup-')).length,1);
 }finally{await clean(f.temp);}
});
