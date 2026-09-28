import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReport,REPORT_LIMITS} from '../server/report-builder.mjs';
import {encodePng} from '../server/viewer-image.mjs';

function fixture(run) {
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-report-'));
  try {return run(workspace);}finally{fs.rmSync(workspace,{recursive:true,force:true});}
}
const output='artifacts/generated/report.html';
const axis=(label,unit,min,max,scale='linear')=>({label,unit,min,max,scale});
const line=()=>({type:'line',title:'RAW profile',xAxis:axis('Pixel','px',0,4),yAxis:axis('Signal','DN',0,100),series:[{label:'R',points:[[0,10],[2,50],[4,90]]}]});
const spec=section=>({title:'ISP result',sections:[section||line()]});
const read=result=>fs.readFileSync(result.path,'utf8');
const png=(workspace,name='crop.png',width=2,height=1)=>{const file=path.join(workspace,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,encodePng(width,height,Buffer.alloc(width*height*4,127)));return file;};

test('offline report includes explicitly scaled axes, series, supplied histogram/table and provenance',()=>fixture(workspace=>{
  const report=spec(line());
  report.sections.push({type:'histogram',title:'Counts',xAxis:axis('Signal','DN',0,100),yAxis:axis('Count','samples',0,20),bins:[{start:0,end:50,count:5},{start:50,end:100,count:20}]});
  report.sections.push({type:'table',title:'Measurements',columns:['Metric','Value'],rows:[['MSE',4.2],['Verified',true],['Unavailable',null]]});
  report.findings=['Author supplied observation'];report.limitations=['No automatic improvement judgment'];report.provenance=[{label:'Source','value':'run-17, image A, ROI (0, 0, 4, 1)'}];
  const result=buildReport(workspace,report,output),html=read(result);
  assert.equal(result.path,fs.realpathSync(path.join(workspace,output)));
  assert.equal(result.relativePath,output);assert.equal(result.bytes,Buffer.byteLength(html));
  assert.equal(result.sections,3);assert.equal(result.images,0);assert.equal(result.dataPoints,11);
  assert.match(html,/Signal \(DN; linear\)/);assert.match(html,/Pixel \(px; linear\)/);
  assert.match(html,/points="80,292 410,180 740,68"/);
  assert.match(html,/0 to 50: 5/);assert.match(html,/without normalization or recomputation/);
  assert.match(html,/<td>MSE<\/td><td>4.2<\/td>/);assert.match(html,/run-17, image A/);
  assert.match(html,/Content-Security-Policy/);assert.doesNotMatch(html,/<script|<iframe|<link|onload=/i);
  assert.doesNotMatch(html,/(?:src|href)="https?:/i);
}));

test('all authored HTML and SVG text is escaped without adding executable content',()=>fixture(workspace=>{
  const hostile='</text><script>alert("bad")</script><img src=x onerror=alert(1)> &';
  const report=spec(line());report.title=hostile;report.subtitle=hostile;report.sections[0].title=hostile;
  report.sections[0].xAxis.label=hostile;report.sections[0].series[0].label=hostile;
  report.sections.push({type:'table',title:hostile,columns:[hostile],rows:[[hostile]]});
  report.findings=[hostile];report.limitations=[hostile];report.provenance=[{label:hostile,value:hostile}];
  const html=read(buildReport(workspace,report,output));
  assert.doesNotMatch(html,/<script>|<img src=x|<\/text><script/);
  assert.match(html,/&lt;\/text&gt;&lt;script&gt;alert\(&quot;bad&quot;\)/);
  assert.match(html,/aria-label="&lt;\/text&gt;/);
}));

test('images embed original bytes, metadata and equal source-pixel scale without independent fitting',()=>fixture(workspace=>{
  const a=png(workspace,'data/a.png',2,1),b=png(workspace,'.isp/viewer/crops/b.png',4,2);
  const section={type:'images',title:'Reference and output',scale:2,images:[{path:'data/a.png',label:'Before',caption:'Same ROI <unaltered>'},{path:b,label:'After'}]};
  const result=buildReport(workspace,spec(section),output),html=read(result);
  assert.equal(result.images,2);assert.equal(result.dataPoints,0);
  assert.ok(html.includes(`data:image/png;base64,${fs.readFileSync(a).toString('base64')}`));
  assert.ok(html.includes(`data:image/png;base64,${fs.readFileSync(b).toString('base64')}`));
  assert.match(html,/width:4px;height:2px/);assert.match(html,/width:8px;height:4px/);
  assert.match(html,/Common display scale: 2 CSS pixels per source pixel/);
  assert.match(html,/\.images img\{[^}]*max-width:none/);assert.match(html,/\.images figure\{[^}]*flex:none/);
  assert.match(html,/Same ROI &lt;unaltered&gt;/);assert.match(html,/SHA-256: [a-f0-9]{64}/);
  assert.match(html,/\.isp\/viewer\/crops\/b.png/);
}));

test('JPEG and WebP files use their own MIME while non-raster and incomplete headers fail',()=>fixture(workspace=>{
  const jpegSource=fileURLToPath(new URL('../docs/assets/graph.jpg',import.meta.url));
  fs.copyFileSync(jpegSource,path.join(workspace,'graph.jpg'));
  // 1x1 lossless WebP fixture, including RIFF padding.
  fs.writeFileSync(path.join(workspace,'pixel.webp'),Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==','base64'));
  const section={type:'images',title:'Raster types',images:[{path:'graph.jpg',label:'JPEG'},{path:'pixel.webp',label:'WebP'}]};
  const html=read(buildReport(workspace,spec(section),output));
  assert.match(html,/data:image\/jpeg;base64,/);assert.match(html,/data:image\/webp;base64,/);
  fs.writeFileSync(path.join(workspace,'not-image.png'),'<svg onload="alert(1)"></svg>');
  fs.writeFileSync(path.join(workspace,'incomplete.png'),fs.readFileSync(png(workspace)).subarray(0,33));
  const incompleteWebp=Buffer.alloc(30);incompleteWebp.write('RIFF');incompleteWebp.writeUInt32LE(22,4);incompleteWebp.write('WEBPVP8X',8);incompleteWebp.writeUInt32LE(10,16);
  fs.writeFileSync(path.join(workspace,'incomplete.webp'),incompleteWebp);
  for(const file of ['not-image.png','incomplete.png','incomplete.webp'])assert.throws(()=>buildReport(workspace,spec({type:'images',title:'Invalid',images:[{path:file,label:'Invalid'}]}),'artifacts/generated/invalid.html'),/valid bounded PNG, JPEG or WebP/);
}));

test('log axes map supplied values exactly and reject nonpositive or indistinguishable domains',()=>fixture(workspace=>{
  const section=line();section.xAxis=axis('Frequency','Hz',1,100,'log');section.yAxis=axis('Magnitude','DN',1,100,'log');section.series[0].points=[[1,1],[10,10],[100,100]];
  const html=read(buildReport(workspace,spec(section),output));
  assert.match(html,/points="80,320 410,180 740,40"/);assert.match(html,/Frequency \(Hz; log\)/);
  section.xAxis.min=0;assert.throws(()=>buildReport(workspace,spec(section),'artifacts/generated/zero.html'),/positive min/);
  section.xAxis.min=100;section.xAxis.max=100+Number.EPSILON*100;
  assert.throws(()=>buildReport(workspace,spec(section),'artifacts/generated/tiny.html'),/distinguishable/);
}));

test('large finite linear axes avoid intermediate arithmetic overflow',()=>fixture(workspace=>{
  const section=line();section.xAxis.max=1e308;section.series[0].points=[[0,0],[1e308,100]];
  const html=read(buildReport(workspace,spec(section),output));
  assert.match(html,/points="80,320 740,40"/);assert.doesNotMatch(html,/NaN|Infinity/);
  section.xAxis.min=-1e308;
  assert.throws(()=>buildReport(workspace,spec(section),'artifacts/generated/range.html'),/finite increasing/);
}));

test('invalid values, silent options and out-of-axis data are rejected before writing',()=>fixture(workspace=>{
  const invalid=[
    section=>section.series[0].points.push([1,NaN]),
    section=>section.series[0].points.push([Infinity,1]),
    section=>section.series[0].points.push([1,101]),
    section=>section.series[0].points.push(['1',1]),
    section=>section.series[0].points.push([1,1,1]),
    section=>section.xAxis.scale='sqrt',
    section=>delete section.xAxis.unit,
    section=>delete section.yAxis.max,
    section=>section.normalize=true,
    section=>section.series[0].points=[]
  ];
  for(const mutate of invalid) {const section=line();mutate(section);assert.throws(()=>buildReport(workspace,spec(section),output),/Report:/);}
  assert.equal(fs.existsSync(path.join(workspace,output)),false);
  const table={type:'table',title:'Table',columns:['Value'],rows:[[{html:'<b>oops</b>'}]]};
  assert.throws(()=>buildReport(workspace,spec(table),output),/table cells/);
}));

test('histograms require explicit ordered boundaries, a zero linear baseline, and nonnegative counts',()=>fixture(workspace=>{
  const histogram=()=>({type:'histogram',title:'Histogram',xAxis:axis('Value','DN',0,10),yAxis:axis('Count','samples',0,5),bins:[{start:0,end:5,count:2},{start:5,end:10,count:4}]});
  for(const mutate of [s=>s.bins[1].start=4,s=>s.bins[0].count=-1,s=>s.bins[0].end=0,s=>s.yAxis.min=1,s=>s.bins[0].count=6]) {
    const section=histogram();mutate(section);assert.throws(()=>buildReport(workspace,spec(section),output),/Report:/);
  }
  const section=histogram();section.yAxis=axis('Count','samples',1,10,'log');
  const html=read(buildReport(workspace,spec(section),output));assert.match(html,/log axis baseline is its explicit minimum/);
}));

test('output paths stay in artifacts/generated and existing output is never overwritten',()=>fixture(workspace=>{
  const result=buildReport(workspace,spec(),path.join(workspace,output)),original=read(result);
  assert.throws(()=>buildReport(workspace,spec(),output),/already exists/);assert.equal(read(result),original);
  for(const name of ['report.html','artifacts/report.html','artifacts/generated/../../report.html','artifacts/generated/report.svg','artifacts/generated/report:stream.html','../escape.html',path.join(os.tmpdir(),'escape.html')])assert.throws(()=>buildReport(workspace,spec(),name),/Report:/);
  const nested=buildReport(workspace,spec(),'artifacts/generated/run-42/nested.html');assert.ok(fs.existsSync(nested.path));
}));

test('image paths reject traversal, remote URLs, alternate streams and non-files',()=>fixture(workspace=>{
  png(workspace);fs.mkdirSync(path.join(workspace,'folder.png'));
  for(const name of ['../outside.png',path.join(os.tmpdir(),'outside.png'),'https://example.com/a.png','data:image/png;base64,AAAA','crop.png:secret','folder.png']) {
    assert.throws(()=>buildReport(workspace,spec({type:'images',title:'Unsafe',images:[{path:name,label:'Unsafe'}]}),output));
  }
}));

test('symlink and junction input/output parents cannot escape workspace confinement',t=>fixture(workspace=>{
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'isp-report-external-'));
  try {
    png(outside,'outside.png');
    try {fs.symlinkSync(outside,path.join(workspace,'linked'),process.platform==='win32'?'junction':'dir');}
    catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Symlinks unavailable');return;}throw error;}
    assert.throws(()=>buildReport(workspace,spec({type:'images',title:'Linked',images:[{path:'linked/outside.png',label:'Linked'}]}),output),/symbolic links|junctions/);
    fs.mkdirSync(path.join(workspace,'artifacts'));
    fs.symlinkSync(outside,path.join(workspace,'artifacts','generated'),process.platform==='win32'?'junction':'dir');
    assert.throws(()=>buildReport(workspace,spec(),output),/symbolic links|junctions/);
    assert.equal(fs.existsSync(path.join(outside,'report.html')),false);
  } finally {fs.rmSync(outside,{recursive:true,force:true});}
}));

test('limits bound supplied points, source bytes, specification and expanded report bytes',()=>fixture(workspace=>{
  const section=line();section.series[0].points=Array.from({length:REPORT_LIMITS.dataPoints+1},()=>[0,1]);
  assert.throws(()=>buildReport(workspace,spec(section),output),/20000/);
  const big=path.join(workspace,'large.png');fs.writeFileSync(big,'');fs.truncateSync(big,REPORT_LIMITS.imageBytes+1);
  assert.throws(()=>buildReport(workspace,spec({type:'images',title:'Large',images:[{path:'large.png',label:'Large'}]}),output),/image exceeds/);
  const tooMuch=spec();tooMuch.provenance=[{label:'Long',value:'x'.repeat(REPORT_LIMITS.specBytes)}];
  assert.throws(()=>buildReport(workspace,tooMuch,output),/spec exceeds/);
  const expanded=spec({type:'table',title:'Escaping expands text',columns:['A'],rows:Array.from({length:520},()=>['&'.repeat(4000)])});
  const jpegSource=fileURLToPath(new URL('../docs/assets/graph.jpg',import.meta.url));fs.copyFileSync(jpegSource,path.join(workspace,'graph.jpg'));
  expanded.sections.push({type:'images',title:'Image',images:[{path:'graph.jpg',label:'Image'}]});
  assert.throws(()=>buildReport(workspace,expanded,output),/rendered report exceeds/);
  assert.equal(fs.existsSync(path.join(workspace,output)),false);
}));

test('a failed write cleans up its own incomplete output',()=>fixture(workspace=>{
  const write=fs.writeFileSync;
  try {
    fs.writeFileSync=(target,...args)=>{if(typeof target==='number'){write(target,'partial');throw new Error('simulated disk failure');}return write(target,...args);};
    assert.throws(()=>buildReport(workspace,spec(),output),/simulated disk failure/);
    assert.equal(fs.existsSync(path.join(workspace,output)),false);
  }finally{fs.writeFileSync=write;}
  assert.ok(fs.existsSync(buildReport(workspace,spec(),output).path));
}));
