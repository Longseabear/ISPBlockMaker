import {WebSocket} from "ws";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startServer(t, temp, name, extraEnv={}) {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const workspace = path.join(temp, name);
  fs.mkdirSync(workspace);
  const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ISP_WORKSPACE: workspace,
      ISP_STATE_HOME: path.join(temp, "state"),
      ISP_NO_DISCOVERY: "1",
      ...extraEnv,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Server did not start: ${diagnostics}`)), 15000);
    const onData = chunk => {
      diagnostics += chunk;
      if (diagnostics.includes(`http://127.0.0.1:${port}`)) finish();
    };
    const onExit = code => finish(new Error(`Server exited (${code}): ${diagnostics}`));
    const onError = error => finish(error);
    function finish(error) {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      error ? reject(error) : resolve();
    }
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
  return { origin: `http://127.0.0.1:${port}`, port };
}




test('MCP API protects settings and applies multiple servers to an actual PTY agent launch', {skip:process.platform!=='win32'},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-mcp-api-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const bin=path.join(temp,'bin'),entry=path.join(bin,'node_modules/@openai/codex/bin/codex.js');fs.mkdirSync(path.dirname(entry),{recursive:true});
 fs.writeFileSync(entry,"console.log('MCP_ARGV:'+Buffer.from(JSON.stringify(process.argv.slice(2))).toString('base64'));setInterval(()=>{},1000);");
 const {origin}=await startServer(t,temp,'workspace',{PATH:bin+path.delimiter+process.env.PATH});
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json()),headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/api/mcp')).status,401);
 const local={name:'stdio_test',enabled:true,agents:['codex'],transport:'stdio',command:'node',args:['space path/server.mjs','& echo BAD','한글'],env:{},url:'',headers:{}};
 const remote={...local,name:'http_test',transport:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer fake-test'}};
 let response=await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:0,servers:[local,remote]})});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
 assert.equal((await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:0,servers:[]})})).status,400);
 const socket=new WebSocket(origin.replace('http','ws')+'/ws?token='+boot.token);t.after(()=>socket.close());const messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));await once(socket,'open');
 const id=crypto.randomUUID();socket.send(JSON.stringify({type:'start',sessionId:id,agent:'codex',blockId:boot.state.blocks[0].id}));
 const until=async fn=>{for(let i=0;i<240;i++){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,25));}throw Error('MCP PTY event timeout: '+JSON.stringify(messages.filter(m=>m.type==='error')));};
 await until(()=>messages.some(m=>m.type==='started'));
 const encoded=await until(()=>messages.filter(m=>m.type==='output').map(m=>m.data).join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').match(/MCP_ARGV:([A-Za-z0-9+/=]+)/)?.[1]);
 const args=JSON.parse(Buffer.from(encoded,'base64').toString());assert.equal(args[0],'-c');assert.match(args[1],/mcp_servers.stdio_test=/);assert.match(args[1],/& echo BAD/);assert.equal(args[2],'-c');assert.match(args[3],/mcp_servers.http_test=/);
 const active=await fetch(origin+'/api/mcp',{headers}).then(r=>r.json());assert.deepEqual(active.sessions[0].names,['stdio_test','http_test']);assert.equal(active.sessions[0].revision,1);
 await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:1,servers:[]})});const stale=await fetch(origin+'/api/mcp',{headers}).then(r=>r.json());assert.equal(stale.revision,2);assert.equal(stale.sessions[0].revision,1);
 socket.send(JSON.stringify({type:'stop'}));await until(()=>messages.some(m=>m.type==='exit'));
 assert.equal((await fetch(origin+'/api/mcp',{headers}).then(r=>r.json())).sessions.length,0);
});
