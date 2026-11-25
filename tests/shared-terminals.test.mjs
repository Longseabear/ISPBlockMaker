import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {SharedTerminals} from '../server/shared-terminals.mjs';
import {McpAgents} from '../server/mcp-agents.mjs';
function fixture(){const events=[],processes=[],agents=new McpAgents(),a=agents.authenticate(agents.issue('A').token),b=agents.authenticate(agents.issue('B').token);const manager=new SharedTerminals({agents,context:()=>({workspace:process.cwd(),env:process.env}),notify:event=>events.push(event),spawn:()=>{const p={pid:123,writes:[],onData(fn){this.data=fn;},onExit(fn){this.exit=fn;},write(v){this.writes.push(v);},resize(){},kill(){this.exit({exitCode:0});}};processes.push(p);return p;},kill:async p=>p.kill()});const create=(title='Server',actor=a)=>manager.create({id:crypto.randomUUID(),title},actor);return {manager,agents,a,b,events,processes,create};}
const input=(controlVersion=0)=>({requestId:crypto.randomUUID(),data:'echo hello\r',controlVersion});
const socket=()=>({readyState:1,bufferedAmount:0,messages:[],send(text){this.messages.push(JSON.parse(text));},close(){this.readyState=3;}});
test('fast output remains readable from the input acknowledgement and identical retries retain the original cursor',()=>{
 const {manager,a,processes,create}=fixture(),s=create(),request=input();
 processes[0].data('prompt> ');
 processes[0].write=data=>{processes[0].writes.push(data);processes[0].data('hello\r\n');};
 const ack=manager.write(s.id,request,a);
 assert.equal(ack.inputAccepted,true);assert.equal(ack.completion,'not_tracked');assert.ok(ack.shell);
 assert.equal(manager.read(s.id,{cursor:ack.outputCursorBeforeWrite}).output,'hello\r\n');
 assert.equal(manager.read(s.id,{cursor:ack.cursor}).output,'');
 const retry=manager.write(s.id,request,a);assert.equal(retry.outputCursorBeforeWrite,ack.outputCursorBeforeWrite);assert.equal(processes[0].writes.length,1);
 assert.ok(ack.lastInputAt&&ack.lastOutputAt);
});
test('one agent has distinct hidden sessions, retries do not create duplicates',()=>{const {manager,a,b,events,create}=fixture(),s=create();assert.equal(manager.create({id:s.id,title:'Server'},a).id,s.id);assert.throws(()=>manager.create({id:s.id,title:'Server'},b),/already used/);create('SSH');assert.ok(manager.list().every(v=>v.agentId===a.id));assert.equal(events.some(e=>e.type==='shared-present'),false);manager.present(s.id,{reason:'input',message:'Login'},a);assert.equal(events.at(-1).type,'shared-present');assert.equal(manager.present(s.id,{reason:'input',message:'Login'},a).requested,false);});
test('another agent cannot spoof user input, take over, kill or delete',async()=>{const {manager,a,b,create}=fixture(),s=create();assert.equal(manager.read(s.id).agentId,a.id);assert.throws(()=>manager.write(s.id,{...input(),actor:'user'},b),/소유자/);assert.throws(()=>manager.control(s.id,'agent',b.id,b,0),/소유자/);await assert.rejects(manager.stop(s.id,b,0),/소유자/);assert.throws(()=>manager.remove(s.id,b,0),/소유자/);});
test('handoff rejects stale writes even when ownership returns to original agent',()=>{const {manager,a,b,processes,create}=fixture(),s=create(),req=input();manager.write(s.id,req,a);assert.equal(manager.write(s.id,req,a).duplicate,true);manager.control(s.id,'agent',b.id,a,0);assert.throws(()=>manager.write(s.id,input(),a),/소유자/);manager.write(s.id,input(1),b);manager.control(s.id,'agent',a.id,b,1);assert.throws(()=>manager.write(s.id,req,a),/변경/);manager.write(s.id,input(2),a);assert.equal(processes[0].writes.length,3);});
test('human typing preempts stale agent writes and automatic resume waits for submission',()=>{
 const {manager,a,b,create,processes}=fixture(),s=create();
 manager.write(s.id,{...input(0),data:'ec'});
 assert.equal(manager.read(s.id).owner,'user');assert.equal(manager.read(s.id).controlVersion,1);
 assert.throws(()=>manager.write(s.id,input(0),a),/제어권/);
 manager.get(s.id).userInputUntil=0;
 assert.throws(()=>manager.write(s.id,input(1),a),/입력 중/);
 manager.write(s.id,{...input(0),data:'ho hello\r'}); // queued human keys never get dropped for an old UI version
 assert.equal(manager.read(s.id).userInputSequence,2);
 assert.throws(()=>manager.write(s.id,input(2),a),/입력 중/);
 manager.get(s.id).userInputUntil=0;
 manager.write(s.id,input(2),a);assert.equal(manager.read(s.id).owner,'agent');
 assert.throws(()=>manager.write(s.id,input(2),b),/소유자/);
 assert.deepEqual(processes[0].writes,['ec','ho hello\r','echo hello\r']);
});
test('output, quotas, request records and renderer backlogs are bounded',()=>{const {manager,processes,a,b,create}=fixture(),s=create(),client=socket();manager.attach(client,s.id);manager.detach(client);processes[0].data('x'.repeat(210000)+'done');const r=manager.read(s.id,{limit:24000});assert.equal(r.truncated,true);assert.equal(r.output.length,24000);assert.equal(manager.read(s.id,{cursor:210000}).output,'done');manager.attach(client,s.id);manager.acknowledge(client,client.sharedPending);assert.equal(client.sharedPending,0);processes[0].data('y'.repeat(262145));assert.equal(client.readyState,3);assert.equal(manager.get(s.id).sockets.size,0);create();create();create();assert.throws(()=>create(),/4개/);const bs=create('B',b);assert.throws(()=>manager.control(bs.id,'agent',a.id,b,0),/4개/);for(let n=5;n<16;n++)create('User '+n,{kind:'user'});assert.throws(()=>create('extra',{kind:'user'}),/16개/);for(let n=0;n<4096;n++)manager.get(s.id).writes.set(String(n),'hash');assert.throws(()=>manager.write(s.id,input(),a),/기록 한도/);assert.equal(manager.resources().processMemoryLimited,false);});
test('revocation leaves servers alive and requires explicit user reassignment',()=>{const {manager,agents,a,b,create}=fixture(),s=create();agents.revoke(a.id);assert.equal(manager.read(s.id).agent.status,'disconnected');assert.equal(manager.read(s.id).status,'running');assert.throws(()=>manager.control(s.id,'agent'),/연결된/);manager.control(s.id,'agent',b.id);manager.write(s.id,input(1),b);});
test('credentials are unique, revocable, and idle time never grants ownership',()=>{let now=0;const agents=new McpAgents({now:()=>now}),a=agents.issue('Claude','a'),b=agents.issue('Claude','b');assert.notEqual(a.token,b.token);now=120001;assert.equal(agents.get(a.id).status,'unconfirmed');assert.equal(agents.authenticate(a.token).id,a.id);agents.revoke(a.id);assert.equal(agents.authenticate(a.token),null);const renewed=agents.issue('Claude','a');assert.equal(renewed.id,a.id);assert.notEqual(renewed.token,a.token);assert.equal(agents.list().length,2);assert.ok(!JSON.stringify(agents.list()).includes(renewed.token));});
test('exit retains logs, removal releases quota, shutdown refuses new sessions',async()=>{const {manager,processes,a,create}=fixture(),s=create();processes[0].data('logs');await manager.stop(s.id,a,0);assert.equal(manager.read(s.id).output,'logs');manager.remove(s.id,a,0);create();let done;manager.kill=()=>new Promise(r=>{done=r;});const closed=manager.close();assert.throws(()=>create('new'),/종료 중/);done();await closed;assert.equal(manager.list().length,0);});

test('memory pressure refuses new processes without killing existing sessions',()=>{const {manager,create,processes}=fixture();create();manager.freeMemory=()=>128*1024*1024;assert.throws(()=>create('new'),/256 MiB/);assert.equal(processes.length,1);assert.equal(manager.list()[0].status,'running');});
test('input throttling and screen fanout limits reject excess requests',()=>{const {manager,a,create}=fixture(),s=create();for(let n=0;n<4;n++)manager.attach(socket(),s.id);assert.throws(()=>manager.attach(socket(),s.id),/4개/);for(let n=0;n<4;n++)manager.write(s.id,{...input(),data:'x'.repeat(16000)},a);assert.throws(()=>manager.write(s.id,{...input(),data:'x'.repeat(16000)},a),/속도 한도/);});


test('user terminal keys grant one agent existing control, protect retries and never leak through lists',()=>{
 const {manager,a,b,create,processes,events}=fixture(),s=create('User shell',{kind:'user'});
 assert.throws(()=>manager.issueJoinKey(s.id,a),/Only the user/);
 const {key}=manager.issueJoinKey(s.id);
 assert.ok(!JSON.stringify([manager.list(),manager.read(s.id),events]).includes(key));
 const joined=manager.join(key,a);assert.equal(joined.id,s.id);assert.equal(joined.controlVersion,1);
 assert.equal(processes.length,1);assert.equal(processes[0].writes.length,0);
 assert.deepEqual(manager.join(key,a),joined);assert.throws(()=>manager.join(key,b),/already used/);
 manager.write(s.id,input(1),a);manager.control(s.id,'user');
 assert.throws(()=>manager.join(key,a),/already used/);
 const old=manager.issueJoinKey(s.id).key,newKey=manager.issueJoinKey(s.id).key;
 assert.throws(()=>manager.join(old,b),/Invalid/);assert.equal(manager.join(newKey,b).agentId,b.id);
 assert.throws(()=>manager.write(s.id,input(1),a),/소유자/);
});

test('terminal join respects receiving agent quota and rejects exited or cross-workspace keys',async()=>{
 const {manager,a,b,create}=fixture();for(let i=0;i<4;i++)create('Owned',a);
 const s=create('Target',{kind:'user'}),{key}=manager.issueJoinKey(s.id);
 assert.throws(()=>manager.join(key,a),/4개/);assert.equal(manager.get(s.id).owner,'user');
 assert.throws(()=>fixture().manager.join(key,a),/Invalid/);
 await manager.stop(s.id);assert.throws(()=>manager.join(key,b),/Invalid/);
});
