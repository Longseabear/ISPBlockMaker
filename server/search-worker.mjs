import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';

const db=new DatabaseSync(workerData.file);
db.exec(`PRAGMA journal_mode=WAL;
 CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(id UNINDEXED,title,body,tokenize='unicode61');
 CREATE VIRTUAL TABLE IF NOT EXISTS substrings USING fts5(id UNINDEXED,title,body,tokenize='trigram');`);
let documents=new Map(),generation=0,initialized=false;
function terms(query){return query.normalize('NFKC').match(/"[^"]+"|[^\s"]+/gu)?.slice(0,32)||[];}
function expression(query,mode){return terms(query).map(t=>'"'+t.replace(/^"|"$/g,'').replaceAll('"','""')+'"').join(mode==='all'?' AND ':' OR ');}
parentPort.on('message',({id,action,payload})=>{
 try{
  let result;
  if(action==='index'){
   const next=new Map(payload.documents.map(d=>[d.id,d]));
   if(next.size!==payload.documents.length)throw Error('Duplicate search document ID');
   const removed=[...documents.keys()].filter(id=>!next.has(id));
   const updated=payload.documents.filter(d=>{const old=documents.get(d.id);return !old||old.hash!==d.hash||old.title!==d.title;});
   const changed=!initialized||removed.length>0||payload.documents.some(d=>JSON.stringify(d)!==JSON.stringify(documents.get(d.id)));
   db.exec('BEGIN');
   try{
    if(!initialized)db.exec('DELETE FROM documents; DELETE FROM substrings');
    const insert=db.prepare('INSERT INTO documents(id,title,body) VALUES (?,?,?)'),tri=db.prepare('INSERT INTO substrings(id,title,body) VALUES (?,?,?)');
    const drop=db.prepare('DELETE FROM documents WHERE id=?'),dropTri=db.prepare('DELETE FROM substrings WHERE id=?');
    for(const id of [...removed,...updated.map(d=>d.id)]){drop.run(id);dropTri.run(id);}
    for(const d of updated){insert.run(d.id,d.title.normalize('NFKC'),d.text.normalize('NFKC'));tri.run(d.id,d.title.normalize('NFKC'),d.text.normalize('NFKC'));}
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   documents=next;initialized=true;if(changed)generation++;result={generation,indexed:updated.length,removed:removed.length};
  }else if(action==='search'){
   const {query,mode='any',allowedIds,limit=10,offset=0}=payload,allowed=new Set(allowedIds);
   const q=expression(query,mode),ranked=new Map();
   if(q){
    for(const table of ['documents','substrings']){
     for(const row of db.prepare(`SELECT id,bm25(${table},0,8,1) score FROM ${table} WHERE ${table} MATCH ? ORDER BY score`).all(q)){
      if(!allowed.has(row.id)||ranked.has(row.id))continue;
      ranked.set(row.id,{id:row.id,score:row.score,match:table==='documents'?'keywords':'substring'});
     }
    }
   }
   const short=terms(query).map(t=>t.replace(/^"|"$/g,'').toLowerCase()).filter(t=>t.length<3);
   for(const d of documents.values()){
    if(!allowed.has(d.id))continue;
    if(d.id===query||d.path===query)ranked.set(d.id,{id:d.id,score:-Infinity,match:'identifier'});
    else if(!ranked.has(d.id)&&short.length&&terms(query).length===short.length&& (mode==='all'?short.every(t=>d.title.toLowerCase().includes(t)):short.some(t=>d.title.toLowerCase().includes(t))))ranked.set(d.id,{id:d.id,score:0,match:'short-title'});
   }
   const rows=[...ranked.values()];rows.sort((a,b)=>(a.match==='identifier'?-1:b.match==='identifier'?1:0));
   const counts={by_type:Object.create(null),by_diagram:Object.create(null)};
   for(const row of rows){const d=documents.get(row.id);counts.by_type[d.type]=(counts.by_type[d.type]||0)+1;if(d.diagram_id)counts.by_diagram[d.diagram_id]=(counts.by_diagram[d.diagram_id]||0)+1;}
   result={generation,total:rows.length,counts,results:rows.slice(offset,offset+limit).map(r=>({...documents.get(r.id),match:r.match}))};
  }else throw Error('Unknown search operation');
  parentPort.postMessage({id,result});
 }catch(e){parentPort.postMessage({id,error:e.message});}
});
