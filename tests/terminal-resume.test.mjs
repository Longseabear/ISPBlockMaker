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

async function startServer(t, temp, name) {
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



test('terminal survives browser disconnect, replays history, and transfers exclusive input ownership', async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-terminal-resume-'));
 t.after(()=>{if(path.dirname(temp)!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');fs.rmSync(temp,{recursive:true,force:true});});
 const {origin}=await startServer(t,temp,'workspace');
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const sockets=[];t.after(()=>sockets.forEach(s=>s.close()));
 const sessionId=crypto.randomUUID(), blockId=boot.state.blocks[0].id;
 const until=async fn=>{for(let i=0;i<200;i++){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('Terminal event timeout');};
 async function connect(){const s=new WebSocket(origin.replace('http','ws')+'/ws?token='+boot.token);s.messages=[];s.on('message',data=>s.messages.push(JSON.parse(data)));sockets.push(s);await once(s,'open');s.send(JSON.stringify({type:'start',sessionId,agent:'shell',blockId}));await until(()=>s.messages.find(m=>m.type==='started'));return s;}
 const first=await connect();
 const command=process.platform==='win32'?'set ISP_RESUME_PROBE=survived-session\r':'export ISP_RESUME_PROBE=survived-session\r';
 first.send(JSON.stringify({type:'input',data:command}));
 await until(()=>first.messages.some(m=>m.type==='output'&&m.data.includes('ISP_RESUME_PROBE')));
 first.close();await once(first,'close');
 const second=await connect();assert.match(second.messages.find(m=>m.type==='started').buffer,/ISP_RESUME_PROBE/);
 second.send(JSON.stringify({type:'input',data:process.platform==='win32'?'echo %ISP_RESUME_PROBE%\r':'echo $ISP_RESUME_PROBE\r'}));
 await until(()=>second.messages.some(m=>m.type==='output'&&m.data.includes('survived-session')));
 const third=await connect();await until(()=>second.messages.some(m=>m.type==='detached'));
 second.send(JSON.stringify({type:'input',data:'echo old-owner\r'}));await until(()=>second.messages.some(m=>m.type==='error'));
 third.send(JSON.stringify({type:'stop'}));await until(()=>third.messages.some(m=>m.type==='exit'));
});
