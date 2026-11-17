import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse,serialize} from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import parseSrcset from 'parse-srcset';
import {safeGraphPath} from './graph-storage.mjs';

export const MAX_REPORT_BYTES=10*1024*1024;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'};
const fail=message=>{throw Error('Report assets: '+message);};
const attr=(node,name)=>node.attrs?.find(a=>a.name===name);
const textNode=(value,parentNode)=>({nodeName:'#text',value,parentNode});
const cssUnescape=value=>value.replace(/\\([0-9a-f]{1,6}\s?|[^\r\n])/gi,(_,c)=>/^[0-9a-f]/i.test(c)?String.fromCodePoint(parseInt(c.trim(),16)||0xfffd):c);

// Packages resources only; no browser execution or visual-quality checks.
export function packageReportHtml(workspace,htmlFile,original){
 const assets=new Map(),cache=new Map(),cssStack=new Set();let total=0,changed=false;
 const relative=file=>path.relative(workspace,file).replaceAll('\\','/');
 function read(file){
  const name=relative(file),safe=safeGraphPath(workspace,name);
  if(cache.has(safe))return cache.get(safe);
  let stat;try{stat=fs.statSync(safe);}catch{fail('Missing local asset: '+name);}
  if(!stat.isFile()||stat.size>MAX_REPORT_BYTES)fail('Asset must be a file of at most 10 MiB: '+name);
  if(assets.size>=256||total+stat.size>20*1024*1024)fail('Asset budget exceeded (256 files / 20 MiB input)');
  const bytes=fs.readFileSync(safe);total+=bytes.length;
  assets.set(name,{path:name,sha256:hash(bytes),bytes:bytes.length});cache.set(safe,bytes);return bytes;
 }
 function resolve(url,base){
  url=url.trim();if(!url||url.startsWith('#')||/^data:/i.test(url))return null;
  if(/^[a-z][a-z\d+.-]*:/i.test(url)||url.startsWith('/')||url.includes('\\'))fail('Use a relative local asset path, not '+url.slice(0,180));
  let decoded;try{decoded=decodeURIComponent(url.split(/[?#]/)[0]);}catch{fail('Invalid asset URL: '+url);}
  if(!decoded||decoded.includes('\0')||decoded.includes(':')||decoded.includes('\\')||path.isAbsolute(decoded))fail('Invalid asset path: '+url);
  const file=path.resolve(path.dirname(base),decoded);
  safeGraphPath(workspace,relative(file));return {file,fragment:url.includes('#')?'#'+url.split('#').slice(1).join('#'):''};
 }
 function embed(url,base){
  const ref=resolve(url,base);if(!ref)return url;
  const type=mime[path.extname(ref.file).toLowerCase()];if(!type)fail('Unsupported image/font asset: '+relative(ref.file));
  const bytes=read(ref.file);changed=true;return 'data:'+type+';base64,'+bytes.toString('base64')+ref.fragment;
 }
 function cssValue(value,base){
  const parsed=valueParser(value);
  parsed.walk(node=>{
   if(node.type==='function'&&node.value.toLowerCase()==='url'){
    const raw=node.nodes.length===1&&node.nodes[0].type==='string'?node.nodes[0].value:valueParser.stringify(node.nodes).trim();
    const url=embed(cssUnescape(raw),base);node.nodes=[{type:'string',quote:'"',value:url}];return false;
   }
   if(node.type==='function'&&/^(?:-webkit-)?image-set$/i.test(node.value)){
    for(const child of node.nodes)if(child.type==='string')child.value=embed(cssUnescape(child.value),base);
   }
  });return parsed.toString();
 }
 function css(source,base){
  const tree=postcss.parse(source,{from:base});
  tree.walkAtRules(/^import$/i,rule=>{
   const params=valueParser(rule.params),first=params.nodes.find(n=>n.type!=='space'&&n.type!=='comment');
   let url;if(first?.type==='string')url=first.value;else if(first?.type==='function'&&first.value.toLowerCase()==='url')url=first.nodes[0]?.value;
   if(!url)fail('Unsupported CSS @import in '+relative(base));
   const ref=resolve(cssUnescape(url),base);if(!ref)fail('CSS @import must reference a local CSS file');
   if(path.extname(ref.file).toLowerCase()!=='.css')fail('CSS @import must reference .css');
   if(cssStack.has(ref.file)||cssStack.size>=32)fail('Cyclic or excessively nested CSS @import: '+relative(ref.file));
   // Conditional imports are preserved as data CSS URLs, retaining media/layer/supports syntax.
   cssStack.add(ref.file);const content=css(read(ref.file).toString('utf8'),ref.file);cssStack.delete(ref.file);
   // Inline rather than emit @import: the report CSP intentionally forbids fetching stylesheets.
   const rest=valueParser.stringify(params.nodes.slice(params.nodes.indexOf(first)+1)).trim();
   let nested=postcss.parse(content).nodes;
   if(rest){if(/^(layer|supports)\b/i.test(rest))fail('CSS @import layer/supports requires a precombined stylesheet');const media=postcss.atRule({name:'media',params:rest});media.append(nested);nested=[media];}
   rule.replaceWith(...nested);changed=true;
  });
  tree.walkDecls(decl=>{decl.value=cssValue(decl.value,base);});
  return tree.toString();
 }
 const document=parse(original.toString('utf8'));
 function walk(node){
  if(node.tagName==='base')fail('HTML <base> is unsupported; use paths relative to the HTML file');
  if(node.tagName==='link'&&attr(node,'rel')?.value.toLowerCase().split(/\s+/).includes('stylesheet')){
   const href=attr(node,'href')?.value,ref=href&&resolve(href,htmlFile);
   if(!ref)fail('Stylesheet links must reference local .css files; inline existing CSS instead');
   if(path.extname(ref.file).toLowerCase()!=='.css')fail('Stylesheet link must reference .css');
   cssStack.add(ref.file);const content=css(read(ref.file).toString('utf8'),ref.file);cssStack.delete(ref.file);
   node.tagName=node.nodeName='style';node.attrs=node.attrs.filter(a=>!['href','rel','integrity','crossorigin'].includes(a.name));
   node.childNodes=[textNode(content.replace(/<\/style/gi,'<\\/style'),node)];changed=true;
  }else if(node.tagName==='style'){
   const content=node.childNodes.map(n=>n.value||'').join('');node.childNodes=[textNode(css(content,htmlFile).replace(/<\/style/gi,'<\\/style'),node)];
  }
  if(node.tagName==='script'&&attr(node,'src')){
   if(attr(node,'type')?.value.toLowerCase()==='module')fail('Bundle JavaScript modules into one inline script before registration');
   const ref=resolve(attr(node,'src').value,htmlFile);
   if(!ref){if(/^data:(?:text|application)\/javascript[;,]/i.test(attr(node,'src').value))return;fail('Script src must reference a local JavaScript file');}
   if(!['.js','.cjs'].includes(path.extname(ref.file).toLowerCase()))fail('Script src must reference .js or .cjs');
   const bytes=read(ref.file),content=bytes.toString('utf8').replace(/<\/script/gi,'<\\/script');
   if(attr(node,'defer')||attr(node,'async')){attr(node,'src').value='data:text/javascript;base64,'+bytes.toString('base64');node.attrs=node.attrs.filter(a=>!['integrity','crossorigin'].includes(a.name));}
   else{node.attrs=node.attrs.filter(a=>!['src','integrity','crossorigin'].includes(a.name));node.childNodes=[textNode(content,node)];}changed=true;
  }
  for(const a of node.attrs||[]){
   if(a.name==='style')a.value=cssValue(a.value,htmlFile);
   if((['img','input','source'].includes(node.tagName)&&a.name==='src')||(node.tagName==='video'&&a.name==='poster')||(node.tagName==='image'&&a.name==='href')||(node.tagName==='link'&&/icon/i.test(attr(node,'rel')?.value||'')&&a.name==='href'))a.value=embed(a.value,htmlFile);
   if(['img','source'].includes(node.tagName)&&a.name==='srcset'){
    const candidates=parseSrcset(a.value);if(!candidates.length)fail('Invalid srcset');
    a.value=candidates.map(c=>embed(c.url,htmlFile)+(c.w?' '+c.w+'w':c.d?' '+c.d+'x':'')+(c.h?' '+c.h+'h':'')).join(', ');
   }
  }
  for(const child of node.childNodes||[])walk(child);
  if(node.content)walk(node.content);
 }
 walk(document);
 const bytes=changed?Buffer.from(serialize(document)):original;
 if(bytes.length>MAX_REPORT_BYTES)fail('Packaged HTML exceeds 10 MiB; reduce included assets');
 return {bytes,assets:[...assets.values()],sha256:hash(bytes)};
}
