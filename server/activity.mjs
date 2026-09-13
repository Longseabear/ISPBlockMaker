import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function recordActivity(dir,event){const file=path.join(dir,'activity.json');fs.mkdirSync(dir,{recursive:true});const items=readActivity(dir);items.unshift({id:crypto.randomUUID(),time:new Date().toISOString(),...event});fs.writeFileSync(file+'.tmp',JSON.stringify(items.slice(0,1000)));fs.renameSync(file+'.tmp',file);}
export function readActivity(dir){try{return JSON.parse(fs.readFileSync(path.join(dir,'activity.json'),'utf8'));}catch{return [];}}
