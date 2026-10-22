import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {blockDirectory} from '../server/graph-storage.mjs';
import {WorkspaceSearch} from '../server/workspace-search.mjs';
import {evidenceWindow} from '../server/search-evidence.mjs';
import {retrieveContext} from '../server/retrieve-context.mjs';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-search-')),dataDir=path.join(root,'.isp'),store=createStore(dataDir,path.join(root,'graph.json'));store.migrate();
 const block=store.get().blocks[0],dir=path.join(root,blockDirectory(block.id,block.diagramId),'docs');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'noise.md'),'# 노이즈 분산\n\nNoise variance depends on signal.\n노이즈의 분산을 측정합니다.\n');
 const search=new WorkspaceSearch({sourceRoot:root,dataDir,store});t.after(async()=>{await search.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10});});return {root,dir,store,search};
}
test('BM25 phrase search returns original evidence; edits invalidate hashes and removed files disappear',async t=>{
 const {search,dir}=await fixture(t);const result=await search.search({query:'"Noise variance"'});assert.equal(result.total,1);const hit=result.results[0];assert.match(hit.excerpt,/Noise variance/);assert.ok(hit.hash);assert.equal(hit.type,'document');
 const read=await search.read({document_id:hit.id,hash:hit.hash});assert.match(read.text,/노이즈/);
 fs.writeFileSync(path.join(dir,'noise.md'),'# Changed\nDifferent evidence');await assert.rejects(()=>search.read({document_id:hit.id,hash:hit.hash}),/changed/);
 fs.unlinkSync(path.join(dir,'noise.md'));assert.equal((await search.search({query:'"Noise variance"'})).total,0);
});
test('Korean substring and diagram filters work without exposing excluded paths',async t=>{
 const {search,root}=await fixture(t);fs.writeFileSync(path.join(root,'.env'),'SECRET SEARCHMARKER');
 assert.ok((await search.search({query:'노이즈'})).total>0);
 assert.equal((await search.search({query:'노이즈',diagram_id:'missing'})).total,0);
 assert.equal((await search.search({query:'SEARCHMARKER'})).total,0);
 await assert.rejects(()=>search.read({document_id:'file:../secret'}),/not found/);
});
test('public query excludes local jobs from search, counts and direct document reads',async t=>{
 const {search,store}=await fixture(t);const state=structuredClone(store.get()),b=state.blocks[0];
 b.jobs=[{id:'secret-job',title:'PrivateTaskMarker',description:'not shared',status:'pending',createdAt:new Date().toISOString(),resolution:''}];
 store.graph(state,state.revision);
 const local=await search.search({query:'PrivateTaskMarker'});assert.equal(local.total,1);
 const shared=await search.search({query:'PrivateTaskMarker'},{public:true});assert.equal(shared.total,0);assert.deepEqual(shared.counts.by_type,{});assert.equal(local.counts.by_type.job,1);
 await assert.rejects(()=>search.read({document_id:local.results[0].id},{public:true}),/not found/);
});

test('evidence line ranges reflect actual clipped text and reject out-of-range reads',async t=>{
 const clipped=evidenceWindow(['first','x'.repeat(2000),'third'],0,3,1200);
 assert.equal(clipped.end_line,2);assert.equal(clipped.partial_last_line,true);assert.equal(clipped.text.length,1200);
 const unicode=evidenceWindow(['ab😀tail'],0,1,3);assert.equal(unicode.text,'ab');
 const {search}=await fixture(t);const hit=(await search.search({query:'"Noise variance"'})).results[0];
 await assert.rejects(search.read({document_id:hit.id,start_line:9999}),/beyond/);
});

test('referenced source is local-searchable and public only after explicit selection',async t=>{
 const {search,root,store}=await fixture(t),state=structuredClone(store.get());
 fs.writeFileSync(path.join(root,'filter.py'),'# SourceOnlyMarker\ndef filter_image(x): return x\n');state.blocks[0].implementation='filter.py';store.graph(state,state.revision);
 const local=await search.search({query:'SourceOnlyMarker'});assert.equal(local.total,1);assert.equal(local.results[0].type,'source');
 const catalog=await search.catalog();assert.ok(catalog.sources.some(s=>s.path==='filter.py'));
 assert.equal((await search.search({query:'SourceOnlyMarker'},{public:true})).total,0);
 await assert.rejects(search.read({document_id:local.results[0].id},{public:true}),/not found/);
 const scope={public:true,documentIds:[local.results[0].id]};assert.equal((await search.search({query:'SourceOnlyMarker'},scope)).total,1);
 assert.match((await search.read({document_id:local.results[0].id},scope)).text,/filter_image/);
 fs.unlinkSync(path.join(root,'filter.py'));assert.equal((await search.search({query:'SourceOnlyMarker'},scope)).total,0);
});

test('retrieval adds adjacent contracts, excludes private JOBs and bounds the complete JSON',async t=>{
 const {search,store}=await fixture(t);const graph=structuredClone(store.get()),block=graph.blocks[0];
 block.agentContract.inputs='ContextInputMarker';block.jobs=[{id:'private-retrieval',title:'PrivateRetrievalJob',description:'Do not share',status:'pending',createdAt:new Date().toISOString(),resolution:''}];store.graph(graph,graph.revision);
 const result=await retrieveContext({search,store,scope:{public:true},input:{query:'"Noise variance"'},maxChars:12000});
 assert.ok(result.blocks.some(b=>b.block_id===block.id));assert.ok(result.blocks.some(b=>b.relation==='neighbor'));assert.ok(result.edges.length>0);
 assert.equal(result.blocks.find(b=>b.block_id===block.id).contract.inputs,'ContextInputMarker');assert.ok(!JSON.stringify(result).includes('PrivateRetrievalJob'));
 const bounded=await retrieveContext({search,store,scope:{public:true},input:{query:'"Noise variance"'},maxChars:1000});assert.ok(JSON.stringify(bounded).length<=1000);assert.equal(bounded.truncated,true);
});

test('search recovers after worker termination without serving cached deleted evidence',async t=>{
 const {search,dir}=await fixture(t);assert.equal((await search.search({query:'"Noise variance"'})).total,1);
 await search.worker.terminate();fs.unlinkSync(path.join(dir,'noise.md'));
 assert.equal((await search.search({query:'"Noise variance"'})).total,0);
 assert.ok(search.worker);
});
