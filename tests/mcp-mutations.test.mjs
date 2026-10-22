import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {McpMutations} from '../server/mcp-mutations.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-mutation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,ledger:new McpMutations(root)};}
test('concurrent retries and process restart reuse the durable result without repeating an action',async t=>{
 const {root,ledger}=fixture(t),input={request_id:crypto.randomUUID(),revision:1,patch:{name:'New'}};let calls=0,release;
 const pending=new Promise(r=>release=r),action=async()=>{calls++;await pending;return {revision:2};};
 const first=ledger.execute('update',input,action),second=ledger.execute('update',input,action);release();
 assert.deepEqual(await first,{revision:2});assert.deepEqual(await second,{revision:2});assert.equal(calls,1);
 const restarted=new McpMutations(root);assert.deepEqual(await restarted.execute('update',input,action),{revision:2});assert.equal(calls,1);
 await assert.rejects(restarted.execute('update',{...input,revision:2},action),/conflict/);
});
test('uncertain actions are never automatically repeated, including an interrupted pending record',async t=>{
 const {root,ledger}=fixture(t),input={request_id:crypto.randomUUID()};let calls=0;
 await assert.rejects(ledger.execute('run',input,async()=>{calls++;throw Error('Connection ended after dispatch');}),/Connection ended/);
 await assert.rejects(new McpMutations(root).execute('run',input,async()=>calls++),/inspect/);assert.equal(calls,1);
 const file=path.join(root,'mcp-requests',input.request_id+'.json'),record=JSON.parse(fs.readFileSync(file));record.status='pending';delete record.error;fs.writeFileSync(file,JSON.stringify(record));
 await assert.rejects(new McpMutations(root).execute('run',input,async()=>calls++),/uncertain/);assert.equal(calls,1);
});
