import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import katex from 'katex';

const require=createRequire(import.meta.url);
let styles;
// Embed only WOFF2, once per report. No browser JS or network is needed.
export function reportMathStyles(){
  if(styles)return styles;
  const dist=path.dirname(require.resolve('katex'));
  const css=fs.readFileSync(path.join(dist,'katex.min.css'),'utf8');
  styles=css.replace(/src:([^;}]+)/g,(_all,sources)=>{
    const match=sources.match(/url\(fonts\/([A-Za-z0-9_-]+\.woff2)\)/);
    if(!match)throw new Error('Report: unsupported KaTeX font stylesheet');
    const data=fs.readFileSync(path.join(dist,'fonts',match[1])).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
  return styles;
}

export function renderReportMath(latex,displayMode=true){
  if(typeof latex!=='string'||!latex.trim()||latex.length>8000)throw new Error('Report: latex must contain 1–8000 characters');
  return katex.renderToString(latex,{
    displayMode,output:'htmlAndMathml',throwOnError:true,strict:'error',
    trust:()=>{throw new Error('Report: links, HTML and external resources are not allowed in math');},
    maxExpand:1000,maxSize:20,
  });
}

export function reportMathLicense(){
  return fs.readFileSync(path.join(path.dirname(require.resolve('katex')),'..','LICENSE'),'utf8');
}
