import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStore} from '../server/store.mjs';
import {applyGraphOperations} from '../server/graph-operations.mjs';

test('graph operation batches are atomic, revision guarded and explicit about connected edge deletion',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-graph-ops-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=createStore(path.join(root,'.isp'),path.join(root,'graph.json'));store.migrate();
 const initial=structuredClone(store.get()),{jobs,userRequests,...block}=initial.blocks[0];block.id='added';block.name='Added';
 const result=applyGraphOperations(store,{revision:initial.revision,operations:[{action:'add_block',block}]});assert.equal(store.get().blocks.length,initial.blocks.length+1);
 assert.throws(()=>applyGraphOperations(store,{revision:initial.revision,operations:[{action:'remove_block',block_id:'added'}]}),/revision/);
 assert.throws(()=>applyGraphOperations(store,{revision:result.revision,operations:[{action:'remove_block',block_id:'added'},{action:'disconnect',edge_id:'missing'}]}),/Edge not found/);
 assert.ok(store.get().blocks.some(b=>b.id==='added'));assert.equal(store.get().revision,result.revision);
 const edge=store.get().edges[0];assert.ok(edge);
 assert.throws(()=>applyGraphOperations(store,{revision:result.revision,operations:[{action:'remove_block',block_id:edge.source}]}),/connected edges/);
 applyGraphOperations(store,{revision:result.revision,operations:[{action:'remove_block',block_id:edge.source,remove_connected_edges:true}]});
 assert.ok(!store.get().edges.some(e=>e.source===edge.source||e.target===edge.source));
});
