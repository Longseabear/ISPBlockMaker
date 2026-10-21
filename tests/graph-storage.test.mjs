import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createStore,graphSpec} from '../server/store.mjs';
import {initialProject} from '../server/model.mjs';
import {readGraph,readGraphAt,blockDirectory,blockDocuments} from '../server/graph-storage.mjs';
import {packBundle,unpackBundle} from '../server/bundles.mjs';
import {commitChanges} from '../server/versions.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-folders-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));const data=path.join(root,'.isp');const graph=path.join(root,'graph.json');const store=createStore(data,graph);return {root,data,graph,store};}
test('migration backs up exact original bytes, preserves full metadata and local work, and is idempotent',t=>{
 const {root,data,graph,store}=setup(t);const before=structuredClone(store.get());const bytes=fs.readFileSync(graph);store.migrate();
 assert.deepEqual(store.get(),before);const raw=JSON.parse(fs.readFileSync(graph));assert.equal(raw.storageVersion,3);assert.equal(raw.blocks[0].description,undefined);
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
 const {root,graph,store}=setup(t);const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:'pipe'});git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('add','graph.json');git('commit','-m','Legacy');const old=git('rev-parse','HEAD').trim();store.migrate();git('add','graph.json','board');git('commit','-m','Split');const split=git('rev-parse','HEAD').trim();
 const oldGraph=await readGraphAt(file=>git('show',`${old}:${file}`));assert.deepEqual(await readGraphAt(file=>git('show',`${split}:${file}`)),oldGraph);
 const b=store.get().blocks[0];fs.writeFileSync(path.join(root,blockDirectory(b.id),'README.md'),' New explanation\n');git('add','board');git('commit','-m','Docs');const detail=await commitChanges(root,git('rev-parse','HEAD').trim());assert.ok(detail.blockChanges.find(x=>x.id===b.id).fields.includes('detail'));
 assert.equal(readGraph(graph).blocks[0].detail,' New explanation\n');
});
test('split graph bundles round-trip metadata and supporting docs',async t=>{
 const {root,graph,store}=setup(t);store.migrate();const b=store.get().blocks[0],folder=path.join(root,blockDirectory(b.id),'docs');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'algorithm.md'),'Details');const archive=path.join(os.tmpdir(),'isp-docs-'+Date.now()+'.bundle'),target=root+'-restored';t.after(()=>{fs.rmSync(archive,{force:true});fs.rmSync(target,{recursive:true,force:true});});
 await packBundle(root,archive);await unpackBundle(archive,target);assert.deepEqual(readGraph(path.join(target,'graph.json')),readGraph(graph));assert.equal(fs.readFileSync(path.join(target,blockDirectory(b.id),'docs/algorithm.md'),'utf8'),'Details');
});
