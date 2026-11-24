import {monitorEventLoopDelay,performance} from 'node:perf_hooks';

// Bounded, memory-only metadata. Never retain request bodies, query strings,
// authorization headers, terminal output, or workspace paths.
export function createPerformanceDiagnostics(){
 const startedAt=new Date().toISOString(),recent=[],totals=new Map();
 const loop=monitorEventLoopDelay({resolution:20});loop.enable();
 const round=n=>Number(n.toFixed(2));
 function record(kind,name,ms,status){
  const item={time:new Date().toISOString(),kind,name,ms:round(ms),status};
  recent.push(item);if(recent.length>100)recent.shift();
  const key=kind+':'+name;
  if(!totals.has(key)&&totals.size>=100)totals.delete(totals.keys().next().value);
  const value=totals.get(key)||{kind,name,count:0,totalMs:0,maxMs:0};
  value.count++;value.totalMs+=ms;value.maxMs=Math.max(value.maxMs,ms);totals.set(key,value);
 }
 return {
  record,
  middleware(req,res,next){
   const start=performance.now(),json=res.json.bind(res);
   res.json=body=>{if(!res.headersSent)res.setHeader('Server-Timing',`app;dur=${round(performance.now()-start)}`);return json(body);};
   res.once('finish',()=>{
    const route=req.route?.path;if(typeof route!=='string')return;
    const client=['cli','mcp'].includes(req.headers['x-isp-client'])?req.headers['x-isp-client']:'http';
    record(client,req.method+' '+route,performance.now()-start,res.statusCode);
   });
   next();
  },
  snapshot:()=>({startedAt,scope:'This server process only; excludes client scheduling and time before request arrival.',eventLoop:{meanMs:Number.isFinite(loop.mean)?round(loop.mean/1e6):0,maxMs:round(loop.max/1e6),p99Ms:round(loop.percentile(99)/1e6)},recent:[...recent],totals:[...totals.values()].map(v=>({...v,totalMs:round(v.totalMs),maxMs:round(v.maxMs),meanMs:round(v.totalMs/v.count)}))}),
  close:()=>loop.disable(),
 };
}
