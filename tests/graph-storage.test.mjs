import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createStore,graphSpec} from '../server/store.mjs';
import {initialProject} from '../server/model.mjs';
import {readGraph,readGraphAt,blockDirectory,blockDocuments} from '../server/graph-storage.mjs';
import {packBundle,unpackBundle} from '../server/bundles.mjs';
import {commitChanges} from '../server/versions.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-folders-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));const data=path.join(root,'.isp');const graph=path.join(root,'graph.json');const store=createStore(data,graph);return {root,data,graph,store};}
test('migration backs up exact original bytes, preserves full metadata and local work, and is idempotent',t=>{
 const {root,data,graph,store}=setup(t);const before=structuredClone(store.get());const bytes=fs.readFileSync(graph);store.migrate();
 assert.deepEqual(store.get(),before);const raw=JSON.parse(fs.readFileSync(graph));assert.equal(raw.storageVersion,4);assert.equal(raw.diagrams[0].overview,undefined);
 const folder=path.join(root,blockDirectory(before.blocks[0].id));assert.ok(fs.existsSync(path.join(folder,'block.json')));assert.equal(fs.readFileSync(path.join(folder,'README.md'),'utf8'),before.blocks[0].detail);
 const backups=fs.readdirSync(path.join(data,'migrations'));assert.equal(backups.length,1);assert.deepEqual(fs.readFileSync(path.join(data,'migrations',backups[0])),bytes);
 const migrated=fs.readFileSync(graph);store.migrate();assert.deepEqual(fs.readFileSync(graph),migrated);assert.deepEqual(createStore(data,graph).get(),before);
});
test('external README edits update context and reject stale saves; extra docs survive all metadata writes',t=>{
 const {root,graph,store}=setup(t);store.migrate();const stale=structuredClone(store.get());const folder=path.join(root,blockDirectory(stale.blocks[0].id));fs.writeFileSync(path.join(folder,'README.md'),'Long explanation\n');fs.mkdirSync(path.join(folder,'docs'));fs.writeFileSync(path.join(folder,'docs','algorithm.md'),'# Algorithm\nDetail');
 assert.equal(store.get().blocks[0].detail,'Long explanation\n');assert.throws(()=>store.graph(stale,stale.revision),/변경/);
 const current=structuredClone(store.get());current.blocks[0].name='Renamed';store.graph(current,current.revision);assert.equal(blockDocuments(graph,current.blocks[0].id).length,1);assert.equal(fs.readFileSync(path.join(folder,'docs/algorithm.md'),'utf8'),'# Algorithm\nDetail');
});
test('migration refuses collisions before changing source; missing referenced files never reset metadata',t=>{
 const {root,graph,store}=setup(t);const bytes=fs.readFileSync(graph),id=store.get().blocks[0].id;const folder=path.join(root,blockDirectory(id));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'README.md'),'user-owned');assert.throws(()=>store.migrate(),/conflicts/);assert.deepEqual(fs.readFileSync(graph),bytes);assert.equal(fs.readFileSync(path.join(folder,'README.md'),'utf8'),'user-owned');
 fs.renameSync(path.join(folder,'README.md'),path.join(folder,'user-notes.md'));store.migrate();fs.renameSync(path.join(folder,'block.json'),path.join(folder,'block.saved'));assert.throws(()=>store.get(),/ENOENT/);assert.ok(fs.existsSync(path.join(folder,'block.saved')));
});
test('interrupted multi-file save recovers from journal and retains supporting documents',t=>{
 const {root,data,graph,store}=setup(t);store.migrate();const spec=graphSpec(store.get());spec.blocks[0].detail='Recovered detail';const local=JSON.parse(fs.readFileSync(path.join(data,'project.json')));fs.writeFileSync(path.join(data,'storage-transaction.json'),JSON.stringify({spec,local}));
 const restored=createStore(data,graph);assert.equal(restored.get().blocks[0].detail,'Recovered detail');assert.equal(fs.existsSync(path.join(data,'storage-transaction.json')),false);
});
test('legacy Git revisions and split-file revisions both load; diffs report Markdown changes',async t=>{
 const {root,graph,store}=setup(t);const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:'pipe'});git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('add','graph.json');git('commit','-m','Legacy');const old=git('rev-parse','HEAD').trim();store.migrate();git('add','graph.json','diagrams');git('commit','-m','Split');const split=git('rev-parse','HEAD').trim();
 const oldGraph=await readGraphAt(file=>git('show',`${old}:${file}`));assert.deepEqual(await readGraphAt(file=>git('show',`${split}:${file}`)),oldGraph);
 const b=store.get().blocks[0];fs.writeFileSync(path.join(root,blockDirectory(b.id),'README.md'),' New explanation\n');git('add','diagrams');git('commit','-m','Docs');const detail=await commitChanges(root,git('rev-parse','HEAD').trim());assert.ok(detail.blockChanges.find(x=>x.id===b.id).fields.includes('detail'));
 assert.equal(readGraph(graph).blocks[0].detail,' New explanation\n');
});
test('split graph bundles round-trip metadata and supporting docs',async t=>{
 const {root,graph,store}=setup(t);store.migrate();const b=store.get().blocks[0],folder=path.join(root,blockDirectory(b.id),'docs');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'algorithm.md'),'Details');const archive=path.join(os.tmpdir(),'isp-docs-'+Date.now()+'.bundle'),target=root+'-restored';t.after(()=>{fs.rmSync(archive,{force:true});fs.rmSync(target,{recursive:true,force:true});});
 await packBundle(root,archive);await unpackBundle(archive,target);assert.deepEqual(readGraph(path.join(target,'graph.json')),readGraph(graph));assert.equal(fs.readFileSync(path.join(target,blockDirectory(b.id),'docs/algorithm.md'),'utf8'),'Details');
});

test('v3 migration preserves harness definitions, binary helpers, local state and exact legacy files',async t=>{
 const {root,data,graph,store}=setup(t);const spec=structuredClone(store.get());
 spec.diagrams.push({...spec.diagrams[0],id:'dev',name:'Development',kind:'harness'});
 const block=structuredClone(spec.blocks[0]);block.id='dev-step';block.diagramId='dev';block.harnessStep={kind:'manual',phase:'verify',prompt:'Review',acceptance:'Tests pass'};spec.blocks.splice(1,0,block);
 const refs=spec.blocks.map(({id,diagramId,position,detail,userRequests,jobs,...metadata})=>{const dir=`board/blocks/b-${id}`;fs.mkdirSync(path.join(root,dir),{recursive:true});fs.writeFileSync(path.join(root,dir,'block.json'),JSON.stringify({id,...metadata}));fs.writeFileSync(path.join(root,dir,'README.md'),detail);return {id,diagramId,position,metadata:dir+'/block.json'};});
 fs.writeFileSync(graph,JSON.stringify({storageVersion:3,name:spec.name,overview:spec.overview,diagrams:spec.diagrams,blocks:refs,edges:spec.edges}));
 const oldDir=path.join(root,'board/blocks/b-dev-step');fs.mkdirSync(path.join(oldDir,'scripts'));fs.writeFileSync(path.join(oldDir,'scripts/check.py'),'print("verified")');fs.mkdirSync(path.join(oldDir,'fixtures'));fs.writeFileSync(path.join(oldDir,'fixtures/sample.bin'),Buffer.from([0,255,42]));
 fs.mkdirSync(path.join(data,'harness-runs'));const run=path.join(data,'harness-runs/run.json');fs.writeFileSync(run,'{"currentStep":"dev-step"}');
 const before=readGraph(graph),bytes=fs.readFileSync(graph);
 const conflicting=path.join(root,blockDirectory('dev-step','dev'),'scripts/check.py');fs.mkdirSync(path.dirname(conflicting),{recursive:true});fs.writeFileSync(conflicting,'user helper');assert.throws(()=>store.migrate(),/conflicts/);assert.deepEqual(fs.readFileSync(graph),bytes);assert.equal(fs.readFileSync(conflicting,'utf8'),'user helper');fs.unlinkSync(conflicting);
 store.migrate();assert.deepEqual(readGraph(graph),before);assert.equal(fs.readFileSync(run,'utf8'),'{"currentStep":"dev-step"}');
 const newDir=path.join(root,blockDirectory('dev-step','dev'));assert.equal(fs.readFileSync(path.join(newDir,'scripts/check.py'),'utf8'),'print("verified")');assert.deepEqual(fs.readFileSync(path.join(newDir,'fixtures/sample.bin')),Buffer.from([0,255,42]));assert.ok(fs.existsSync(path.join(oldDir,'block.json')));
 assert.ok(fs.readdirSync(path.join(data,'migrations')).some(file=>fs.readFileSync(path.join(data,'migrations',file)).equals(bytes)));
 assert.deepEqual(await readGraphAt(file=>fs.readFileSync(path.join(root,file),'utf8')),before);
 const current=structuredClone(store.get());current.diagrams.find(d=>d.id==='dev').name='Renamed';store.graph(current,current.revision);assert.ok(fs.existsSync(newDir));
});

test('diagram README updates context and block reassignment carries role-specific files without moving product source',t=>{
 const {root,graph,store}=setup(t);store.migrate();let spec=structuredClone(store.get());spec.diagrams.push({...spec.diagrams[0],id:'other',name:'Other'});store.graph(spec,spec.revision);
 const folder=path.join(root,blockDirectory(spec.blocks[0].id));fs.mkdirSync(path.join(folder,'scripts'));fs.writeFileSync(path.join(folder,'scripts/check.py'),'# helper');fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/model.py'),'# product');
 fs.writeFileSync(path.join(root,'diagrams/d-other/README.md'),'Diagram detail');assert.equal(store.get().diagrams.find(d=>d.id==='other').overview.detail,'Diagram detail');
 spec=structuredClone(store.get());spec.edges=[];spec.blocks[0].diagramId='other';store.graph(spec,spec.revision);
 assert.equal(fs.readFileSync(path.join(root,blockDirectory(spec.blocks[0].id,'other'),'scripts/check.py'),'utf8'),'# helper');assert.equal(fs.readFileSync(path.join(root,'src/model.py'),'utf8'),'# product');
});

test('migration refuses unsafe diagram IDs before writing the index',t=>{
 const {root,graph,store}=setup(t);const bytes=fs.readFileSync(graph);const spec=structuredClone(store.get());spec.diagrams[0].id='../escape';assert.throws(()=>store.graph(spec,spec.revision));assert.deepEqual(fs.readFileSync(graph),bytes);
});
