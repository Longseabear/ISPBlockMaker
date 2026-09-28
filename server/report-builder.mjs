import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const REPORT_LIMITS = Object.freeze({specBytes:2*1024*1024,reportBytes:10*1024*1024,imageBytes:4*1024*1024,totalImageBytes:6*1024*1024,dataPoints:20000,sections:32,images:16});
const COLORS = ['#1765b3','#bd4e00','#268347','#9c3a92','#806317','#007c83','#b13f55','#6253b7'];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail = message => { throw new Error(`Report: ${message}`); };

function object(value, name, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unsupported field ${key}`);
  return value;
}
function text(value, name, max=200, empty=false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${name} must be ${empty?'a':'a nonempty'} string of at most ${max} characters`);
  return value;
}
function list(value, name, max, min=1) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${name} must contain ${min} to ${max} items`);
  return value;
}
function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  return value;
}
function budget(state, count) {
  state.dataPoints += count;
  if (state.dataPoints > REPORT_LIMITS.dataPoints) fail(`data exceeds ${REPORT_LIMITS.dataPoints} points/bins/table cells`);
}
function inside(root, file) {
  const relative = path.relative(root,file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function localPath(root, value, name) {
  text(value,name,4096);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) fail(`${name} must be a local filesystem path`);
  if (value.includes('\0') || value.split(/[\\/]/).includes('..')) fail(`${name} cannot contain path traversal`);
  if (value.replace(/^[a-z]:[\\/]/i,'').includes(':')) fail(`${name} cannot contain alternate data streams or colons`);
  const result = path.resolve(root,value);
  if (!inside(root,result)) fail(`${name} must stay within the workspace`);
  return result;
}
// Reject links in every workspace-relative component, including junctions on Windows.
function checkComponents(root, file, createDirectories=false) {
  let current = root;
  const segments = path.relative(root,file).split(path.sep).filter(Boolean);
  for (let i=0;i<segments.length;i++) {
    current = path.join(current,segments[i]);
    let stat;
    try { stat=fs.lstatSync(current); }
    catch(error) {
      if (error.code !== 'ENOENT' || !createDirectories) throw error;
      try { fs.mkdirSync(current); } catch(mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat=fs.lstatSync(current);
    }
    if (stat.isSymbolicLink()) fail('symbolic links and junctions are not allowed in report paths');
    if ((i<segments.length-1 || createDirectories) && !stat.isDirectory()) fail('a report path parent is not a directory');
    if (!inside(root,fs.realpathSync(current))) fail('report path resolves outside the workspace');
  }
}
function axis(value, name) {
  object(value,name,['label','unit','scale','min','max']);
  const label=text(value.label,`${name}.label`),unit=text(value.unit,`${name}.unit`,80);
  if (!['linear','log'].includes(value.scale)) fail(`${name}.scale must be linear or log`);
  const min=number(value.min,`${name}.min`),max=number(value.max,`${name}.max`);
  if (!(max>min) || !Number.isFinite(max-min)) fail(`${name} requires a finite increasing min/max range`);
  if (value.scale==='log' && min<=0) fail(`${name} log scale requires a positive min`);
  const transform=v=>value.scale==='log'?Math.log10(v):v;
  const low=transform(min),span=transform(max)-low;
  if (!(span>0) || !Number.isFinite(span)) fail(`${name} min/max must be distinguishable on the requested scale`);
  return {label,unit,scale:value.scale,min,max,position:v=>(transform(v)-low)/span,tick:i=>i===0?min:i===5?max:value.scale==='log'?10**(low+span*(i/5)):min+(max-min)*(i/5)};
}
function inAxis(value, a, name) {
  number(value,name);
  if (value<a.min || value>a.max) fail(`${name} is outside the explicit axis range [${a.min}, ${a.max}]`);
  return value;
}
const coord = n => { if(!Number.isFinite(n))fail('plot coordinate is not finite'); return Number(n.toFixed(3)); };
const tickText = n => { if(!Number.isFinite(n))fail('axis tick is not finite'); return Number(n.toPrecision(6)).toString(); };
function axesSvg(x,y,title,content,description) {
  let grid='';
  for(let i=0;i<=5;i++) {
    const px=80+i*132,py=320-i*56;
    grid+=`<path class="grid" d="M ${px} 40 V 320 M 80 ${py} H 740"/><text x="${px}" y="342" text-anchor="middle">${esc(tickText(x.tick(i)))}</text><text x="69" y="${py+4}" text-anchor="end">${esc(tickText(y.tick(i)))}</text>`;
  }
  return `<svg class="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(description)}</desc><rect x="80" y="40" width="660" height="280" fill="#fff"/>${grid}<path class="axis" d="M 80 40 V 320 H 740"/>${content}<text x="410" y="377" text-anchor="middle">${esc(x.label)} (${esc(x.unit)}; ${x.scale})</text><text transform="translate(20 180) rotate(-90)" text-anchor="middle">${esc(y.label)} (${esc(y.unit)}; ${y.scale})</text></svg><p class="axis-note">X: ${esc(x.label)} [${esc(x.unit)}], ${x.scale}, ${esc(x.min)} to ${esc(x.max)}. Y: ${esc(y.label)} [${esc(y.unit)}], ${y.scale}, ${esc(y.min)} to ${esc(y.max)}.</p>`;
}
function lineSection(section,state) {
  object(section,'line section',['type','title','xAxis','yAxis','series']);
  const x=axis(section.xAxis,'xAxis'),y=axis(section.yAxis,'yAxis');
  const series=list(section.series,'series',16),legend=[]; let content='';
  for(const [index,s] of series.entries()) {
    object(s,'series',['label','points']); const label=text(s.label,'series.label');
    const points=list(s.points,'series.points',REPORT_LIMITS.dataPoints); budget(state,points.length);
    const mapped=points.map((point,i)=> {
      list(point,`series.points[${i}]`,2,2);
      return [coord(80+x.position(inAxis(point[0],x,'point x'))*660),coord(320-y.position(inAxis(point[1],y,'point y'))*280)];
    });
    const color=COLORS[index%COLORS.length],dash=index>=COLORS.length?' stroke-dasharray="6 4"':'';
    content+=`<polyline fill="none" stroke="${color}" stroke-width="2"${dash} points="${mapped.map(p=>p.join(',')).join(' ')}"><title>${esc(label)}</title></polyline>`;
    if(mapped.length===1) content+=`<circle cx="${mapped[0][0]}" cy="${mapped[0][1]}" r="3" fill="${color}"/>`;
    legend.push(`<li><span class="swatch${dash?' dashed':''}" style="--series-color:${color}"></span>${esc(label)} (${points.length} supplied points)</li>`);
  }
  return axesSvg(x,y,section.title,content,'Line plot of supplied points in their original order. No resampling or derived comparison.')+`<ul class="legend">${legend.join('')}</ul><p class="note">Points are connected in the supplied order; no resampling or numerical comparison is performed.</p>`;
}
function histogramSection(section,state) {
  object(section,'histogram section',['type','title','xAxis','yAxis','bins']);
  const x=axis(section.xAxis,'xAxis'),y=axis(section.yAxis,'yAxis');
  if(y.scale==='linear'&&y.min!==0)fail('histogram linear yAxis.min must be 0');
  const bins=list(section.bins,'histogram bins',REPORT_LIMITS.dataPoints); budget(state,bins.length);
  let previous=-Infinity,content='';
  for(const bin of bins) {
    object(bin,'histogram bin',['start','end','count']);
    const start=inAxis(bin.start,x,'bin start'),end=inAxis(bin.end,x,'bin end'),count=inAxis(bin.count,y,'bin count');
    if(!(end>start) || start<previous)fail('histogram bins must be increasing, nonoverlapping start/end intervals');
    if(count<0)fail('histogram counts cannot be negative'); previous=end;
    const left=80+x.position(start)*660,right=80+x.position(end)*660,top=320-y.position(count)*280;
    content+=`<rect x="${coord(left)}" y="${coord(top)}" width="${coord(right-left)}" height="${coord(320-top)}" fill="${COLORS[0]}" stroke="#fff" stroke-width="0.5"><title>${esc(start)} to ${esc(end)}: ${esc(count)}</title></rect>`;
  }
  return axesSvg(x,y,section.title,content,'Histogram rendered from supplied bin boundaries and counts.')+`<p class="note">${bins.length} supplied bins. Counts are displayed without normalization or recomputation.${y.scale==='log'?' The log axis baseline is its explicit minimum.':''}</p>`;
}
function dimensions(bytes, extension) {
  let width,height,mime;
  if(extension==='.png' && bytes.length>=33 && bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a' && bytes.toString('ascii',12,16)==='IHDR' && bytes.readUInt32BE(8)===13) {
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime='image/png';
    let offset=33,hasPixels=false,hasEnd=false;
    while(offset+12<=bytes.length) {
      const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
      if(offset+length+12>bytes.length)break;
      if(kind==='IDAT'&&length)hasPixels=true;
      offset+=length+12;
      if(kind==='IEND') {hasEnd=length===0&&offset===bytes.length;break;}
    }
    if(!hasPixels||!hasEnd)mime=undefined;
  } else if(['.jpg','.jpeg'].includes(extension) && bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
    let offset=2,hasScan=false;
    while(offset<bytes.length) {
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9)break;
      if(marker===0x01 || (marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const length=bytes.readUInt16BE(offset);
      if(length<2 || offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=8) {
        height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);mime='image/jpeg';
      }
      if(marker===0xda) {hasScan=length>=6&&offset+length<bytes.length-2;break;}
      offset+=length;
    }
    if(!hasScan || bytes.at(-2)!==255 || bytes.at(-1)!==217)mime=undefined;
  } else if(extension==='.webp' && bytes.length>=20 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' && bytes.readUInt32LE(4)+8===bytes.length) {
    const kind=bytes.toString('ascii',12,16),size=bytes.readUInt32LE(16);
    if(size+20<=bytes.length) {
      if(kind==='VP8X'&&size>=10) { width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3); }
      else if(kind==='VP8 '&&size>=10&&bytes.subarray(23,26).toString('hex')==='9d012a') { width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff; }
      else if(kind==='VP8L'&&size>=5&&bytes[20]===0x2f) { const bits=bytes.readUInt32LE(21);width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff); }
      if(width&&height)mime='image/webp';
    }
    let offset=12,hasPixels=false;
    while(offset+8<=bytes.length) {
      const chunk=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),end=offset+8+length;
      if(end>bytes.length)break;
      if(chunk==='VP8 '&&length>=10&&bytes.subarray(offset+11,offset+14).toString('hex')==='9d012a')hasPixels=true;
      if(chunk==='VP8L'&&length>=5&&bytes[offset+8]===0x2f)hasPixels=true;
      // An animated WebP has its image bitstreams inside ANMF frames.
      if(chunk==='ANMF'&&length>=24&&['VP8 ','VP8L','ALPH'].includes(bytes.toString('ascii',offset+24,offset+28)))hasPixels=true;
      offset=end+(length%2);
    }
    if(!hasPixels||offset!==bytes.length)mime=undefined;
  }
  if(!mime || !width || !height || width>32768 || height>32768 || width*height>100000000)fail('image must have a valid bounded PNG, JPEG or WebP header matching its extension');
  return {width,height,mime};
}
function readImage(root,value,state) {
  const file=localPath(root,value,'image.path'); checkComponents(root,file);
  const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const stat=fs.fstatSync(descriptor);
    if(!stat.isFile())fail('image path must be a regular file');
    if(stat.size>REPORT_LIMITS.imageBytes)fail(`image exceeds ${REPORT_LIMITS.imageBytes} bytes`);
    state.imageBytes+=stat.size;
    if(state.imageBytes>REPORT_LIMITS.totalImageBytes)fail(`images exceed ${REPORT_LIMITS.totalImageBytes} total bytes`);
    const bytes=Buffer.alloc(stat.size);let offset=0;
    while(offset<bytes.length) { const got=fs.readSync(descriptor,bytes,offset,bytes.length-offset,offset); if(!got)fail('image changed or was truncated while reading'); offset+=got; }
    if(fs.fstatSync(descriptor).size!==stat.size)fail('image changed while reading');
    checkComponents(root,file);
    const info=dimensions(bytes,path.extname(file).toLowerCase());
    return {...info,data:`data:${info.mime};base64,${bytes.toString('base64')}`,source:path.relative(root,file).split(path.sep).join('/'),hash:crypto.createHash('sha256').update(bytes).digest('hex')};
  } finally {fs.closeSync(descriptor);}
}
function imageSection(section,state,root) {
  object(section,'images section',['type','title','scale','images']);
  const scale=section.scale===undefined?1:number(section.scale,'images.scale');
  if(scale<0.05||scale>4)fail('images.scale must be between 0.05 and 4');
  const images=list(section.images,'images',8);state.images+=images.length;
  if(state.images>REPORT_LIMITS.images)fail(`report exceeds ${REPORT_LIMITS.images} images`);
  const figures=images.map(item=> {
    object(item,'image',['path','label','caption']);const label=text(item.label,'image.label');
    const caption=item.caption===undefined?'':text(item.caption,'image.caption',4000,true),image=readImage(root,item.path,state);
    return `<figure><img src="${image.data}" alt="${esc(label)}" width="${coord(image.width*scale)}" height="${coord(image.height*scale)}" style="width:${coord(image.width*scale)}px;height:${coord(image.height*scale)}px"><figcaption><strong>${esc(label)}</strong>${caption?`<p>${esc(caption)}</p>`:''}<p>${image.width} × ${image.height} source pixels</p><details><summary>Image provenance</summary><p>${esc(image.source)}</p><p class="hash">SHA-256: ${image.hash}</p></details></figcaption></figure>`;
  });
  return `<p class="note">Common display scale: ${scale} CSS pixels per source pixel (${coord(scale*100)}%). Original image bytes are embedded; scroll horizontally to inspect every image.</p><div class="images">${figures.join('')}</div>`;
}
function tableSection(section,state) {
  object(section,'table section',['type','title','columns','rows']);
  const columns=list(section.columns,'table columns',16).map((c,i)=>text(c,`columns[${i}]`));
  const rows=list(section.rows,'table rows',1000,0); budget(state,rows.length*columns.length);
  const rendered=rows.map(row=> {
    list(row,'table row',columns.length,columns.length);
    return `<tr>${row.map(cell=> {
      if(typeof cell==='string')text(cell,'table cell',4000,true);
      else if(typeof cell==='number')number(cell,'table cell');
      else if(cell!==null && typeof cell!=='boolean')fail('table cells must be strings, finite numbers, booleans or null');
      return `<td>${cell===null?'—':esc(cell)}</td>`;
    }).join('')}</tr>`;
  });
  return `<div class="table-scroll"><table><thead><tr>${columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rendered.join('')}</tbody></table></div>`;
}
function textList(values,title) {
  if(values===undefined)return '';
  return `<section><h2>${title}</h2><ul>${list(values,title,100,0).map(v=>`<li>${esc(text(v,title,4000))}</li>`).join('')}</ul></section>`;
}
const CSS = `:root{font:15px/1.5 system-ui,sans-serif;color:#172c40;background:#f3f6f9}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:32px}header,section{padding:24px;background:#fff;border:1px solid #d8e0e8;border-radius:8px;margin-bottom:20px}h1{font-size:30px;margin:0 0 8px}h2{font-size:21px;margin:0 0 16px}p{margin:8px 0}li{margin:6px 0}header p,.note,.axis-note{color:#425970}.note,.axis-note{font-size:13px}.chart{display:block;width:100%;height:auto;max-width:1000px}.chart text{font:12px system-ui,sans-serif;fill:#172c40}.grid{stroke:#e0e7ee;fill:none}.axis{stroke:#61768a;fill:none}.legend{display:flex;flex-wrap:wrap;gap:8px 24px;list-style:none;padding:0}.swatch{display:inline-block;width:25px;border-top:3px solid var(--series-color);margin:0 8px 3px 0}.swatch.dashed{border-top-style:dashed}.images{display:flex;align-items:flex-start;gap:20px;overflow-x:auto;padding:8px 0 16px}.images figure{margin:0;flex:none}.images img{display:block;max-width:none;image-rendering:pixelated;background:#e6ebf0}.images figcaption{width:300px;max-width:100%;overflow-wrap:anywhere;padding-top:8px}.hash{font-size:11px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid #d8e0e8;overflow-wrap:anywhere}th{background:#eef3f8}dl{display:grid;grid-template-columns:minmax(100px,1fr) 3fr;gap:8px 20px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}footer{color:#425970;font-size:12px}section li,header p{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){main{padding:12px}header,section{padding:16px}}@media print{body{background:#fff}main{max-width:none;padding:0}header,section{break-inside:avoid}.images{overflow:visible;flex-wrap:wrap}.images img{max-width:none}details{display:block}}`;

/** Render only explicitly supplied images/data into a new, offline HTML report. */
export function buildReport(workspace,spec,outputPath) {
  if(typeof workspace!=='string')fail('workspace must be a directory path');
  const suppliedRoot=path.resolve(workspace),rootStat=fs.lstatSync(suppliedRoot);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory())fail('workspace must be a directory, not a symbolic link');
  const root=fs.realpathSync(suppliedRoot);
  // Preserve the caller's workspace spelling for absolute paths through a platform alias.
  const resolveInput=value=>{localPath(suppliedRoot,value,'path');return path.isAbsolute(value)&&inside(suppliedRoot,value)?path.resolve(root,path.relative(suppliedRoot,value)):value;};
  const output=localPath(root,resolveInput(outputPath),'output');
  const generated=path.join(root,'artifacts','generated');
  if(!inside(generated,output)||output===generated||path.extname(output).toLowerCase()!=='.html')fail('output must be an .html file under workspace/artifacts/generated');
  let serialized;
  try { serialized=JSON.stringify(spec); } catch {fail('spec must be JSON serializable');}
  if(!serialized || Buffer.byteLength(serialized)>REPORT_LIMITS.specBytes)fail(`spec exceeds ${REPORT_LIMITS.specBytes} bytes or is not JSON`);
  object(spec,'spec',['title','subtitle','sections','findings','limitations','provenance']);
  const title=text(spec.title,'title'),subtitle=spec.subtitle===undefined?'':text(spec.subtitle,'subtitle',4000,true);
  const sections=list(spec.sections,'sections',REPORT_LIMITS.sections),state={dataPoints:0,images:0,imageBytes:0};
  const body=sections.map(section=> {
    if(!section||typeof section!=='object')fail('section must be an object');
    const heading=text(section.title,'section.title'); let content;
    if(section.type==='images') {
      // Do not mutate the caller's spec when canonicalizing absolute input paths.
      const normalized={...section,images:Array.isArray(section.images)?section.images.map(image=>image&&typeof image==='object'?{...image,path:resolveInput(image.path)}:image):section.images};
      content=imageSection(normalized,state,root);
    } else if(section.type==='line')content=lineSection(section,state);
    else if(section.type==='histogram')content=histogramSection(section,state);
    else if(section.type==='table')content=tableSection(section,state);
    else fail('section.type must be images, line, histogram or table');
    return `<section><h2>${esc(heading)}</h2>${content}</section>`;
  }).join('');
  let provenance='';
  if(spec.provenance!==undefined)provenance=`<section><h2>Provenance</h2><dl>${list(spec.provenance,'provenance',100,0).map(entry=>{object(entry,'provenance entry',['label','value']);return `<dt>${esc(text(entry.label,'provenance.label'))}</dt><dd>${esc(text(entry.value,'provenance.value',4000,true))}</dd>`;}).join('')}</dl></section>`;
  const html=`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${CSS}</style></head><body><main><header><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</header>${body}${textList(spec.findings,'Findings')}${textList(spec.limitations,'Limitations')}${provenance}<footer>Offline ISP report. Images and data were supplied by the report author. This renderer does not calculate image differences, compare numeric results, or judge improvement.</footer></main></body></html>\n`;
  const bytes=Buffer.byteLength(html);
  if(bytes>REPORT_LIMITS.reportBytes)fail(`rendered report exceeds ${REPORT_LIMITS.reportBytes} bytes`);
  checkComponents(root,path.dirname(output),true);
  if(fs.existsSync(output) || (()=>{try{return !!fs.lstatSync(output);}catch(e){if(e.code==='ENOENT')return false;throw e;}})())fail('output already exists; choose a new report path');
  const descriptor=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  try {fs.writeFileSync(descriptor,html,'utf8');fs.fsyncSync(descriptor);}
  catch(error) {fs.closeSync(descriptor);try{fs.unlinkSync(output);}catch{}throw error;}
  fs.closeSync(descriptor);
  return {path:output,relativePath:path.relative(root,output).split(path.sep).join('/'),bytes,sections:sections.length,images:state.images,dataPoints:state.dataPoints};
}
