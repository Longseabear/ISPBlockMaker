import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPerformanceDiagnostics} from '../server/performance-diagnostics.mjs';

test('performance metadata is bounded and does not retain payloads, URLs or credentials',()=>{
 const diagnostics=createPerformanceDiagnostics();
 try{
  const req={method:'POST',headers:{authorization:'Bearer SECRET','x-isp-client':'mcp'},url:'/api/recipes?token=SECRET',body:{secret:'PRIVATE'},route:{path:'/api/recipes'}};
  const res=new EventEmitter();res.statusCode=200;res.setHeader=(name,value)=>{assert.equal(name,'Server-Timing');assert.match(value,/app;dur=\d/);};res.json=body=>body;
  diagnostics.middleware(req,res,()=>{});res.json({secret:'PRIVATE'});res.emit('finish');
  const initial=JSON.stringify(diagnostics.snapshot());assert.ok(!initial.includes('SECRET'));assert.ok(!initial.includes('PRIVATE'));assert.ok(initial.includes('POST /api/recipes'));
  for(let i=0;i<200;i++)diagnostics.record('tool','tool_'+i,10,'ok');
  const snapshot=diagnostics.snapshot();assert.equal(snapshot.recent.length,100);assert.equal(snapshot.totals.length,100);assert.equal(snapshot.totals[0].meanMs,10);
 }finally{diagnostics.close();}
});
