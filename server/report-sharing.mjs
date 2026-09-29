import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';

const csp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const mime = {html:'text/html; charset=utf-8',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp'};
export function createReportSharing(directory, current) {
  fs.mkdirSync(directory,{recursive:true});
  const manifest=path.join(directory,'shares.json');
  let saved=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8')):{port:4311,items:[]};
  let server=null, port=null, queue=Promise.resolve();
  const persist=()=>{const tmp=manifest+'.tmp';fs.writeFileSync(tmp,JSON.stringify(saved));fs.renameSync(tmp,manifest);};
  const addresses=()=>Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>(entries||[]).filter(a=>a.family==='IPv4'&&!a.internal).map(a=>({name,address:a.address}))).sort((a,b)=>Number(/tailscale|vpn|virtual|vethernet|wsl|docker|vmware|loopback/i.test(a.name))-Number(/tailscale|vpn|virtual|vethernet|wsl|docker|vmware|loopback/i.test(b.name)));
  const status=()=>({running:!!server,port:port||saved.port,addresses:addresses(),items:saved.items});
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  async function start(requested) {
    if(server)return;
    const first=requested??saved.port;
    if(!Number.isInteger(first)||first<1024||first>65535)throw new Error('Port must be between 1024 and 65535');
    for(let candidate=first;candidate<=Math.min(first+20,65535);candidate++) {
      const listener=http.createServer((req,res)=>{
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',csp);
        const match=/^\/s\/([a-f0-9]{48})$/.exec(req.url||'');
        const item=match&&saved.items.find(i=>i.token===match[1]);
        if(!item||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
        const file=path.join(directory,item.token+'.data');
        try {const stat=fs.statSync(file);res.setHeader('Content-Type',mime[item.kind]||'application/octet-stream');res.setHeader('Content-Length',stat.size);if(req.method==='HEAD'){res.end();return;}res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
      });
      listener.requestTimeout=15000;listener.headersTimeout=10000;
      try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(candidate,'0.0.0.0',()=>{listener.removeListener('error',reject);resolve();});});}
      catch(error){if(error.code==='EADDRINUSE'&&requested==null)continue;throw error;}
      server=listener;port=candidate;saved.port=candidate;persist();return;
    }
    throw new Error('No available sharing port');
  }
  async function stop(){if(!server)return;const old=server;server=null;port=null;await new Promise(resolve=>{old.close(resolve);old.closeAllConnections();});}
  return {
    status,
    start:requested=>serial(async()=>{await start(requested);return status();}),
    stop:()=>serial(async()=>{await stop();return status();}),
    publish:id=>serial(async()=>{
      const {artifactDir,artifacts}=current();const artifact=artifacts.find(a=>a.id===id);
      if(!artifact||!mime[artifact.kind])throw new Error('Unsupported or missing visualization');
      if(path.basename(artifact.file)!==artifact.file)throw new Error('Invalid visualization path');
      const source=path.join(artifactDir,artifact.file),real=fs.realpathSync(source);
      if(path.dirname(real)!==fs.realpathSync(artifactDir)||!fs.statSync(real).isFile())throw new Error('Invalid visualization file');
      if(fs.statSync(real).size>16*1024*1024)throw new Error('Shared report must be at most 16 MiB');
      const bytes=fs.readFileSync(real);
      await start();
      const existing=saved.items.find(i=>i.artifactId===id);
      const item={artifactId:id,token:existing?.token||crypto.randomBytes(24).toString('hex'),title:artifact.title,kind:artifact.kind,revision:artifact.revision,updatedAt:new Date().toISOString()};
      const file=path.join(directory,item.token+'.data');fs.writeFileSync(file+'.tmp',bytes);fs.renameSync(file+'.tmp',file);
      saved.items=saved.items.filter(i=>i.artifactId!==id).concat(item);persist();return status();
    }),
    revoke:token=>serial(async()=>{const item=saved.items.find(i=>i.token===token);if(!item)throw new Error('Share not found');saved.items=saved.items.filter(i=>i!==item);persist();fs.rmSync(path.join(directory,item.token+'.data'),{force:true});return status();})
  };
}

export function installReportSharing(app,directory,current){
  const sharing=createReportSharing(directory,current);
  app.get('/api/report-sharing',(req,res)=>res.json(sharing.status()));
  app.post('/api/report-sharing/start',async(req,res)=>res.json(await sharing.start(req.body.port)));
  app.post('/api/report-sharing/stop',async(req,res)=>res.json(await sharing.stop()));
  app.post('/api/report-sharing/publish',async(req,res)=>res.json(await sharing.publish(req.body.artifactId)));
  app.delete('/api/report-sharing/:token',async(req,res)=>res.json(await sharing.revoke(req.params.token)));
  return sharing;
}
