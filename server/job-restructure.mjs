import crypto from 'node:crypto';
import {z} from 'zod';
const specification=z.object({title:z.string().trim().min(1).max(200),description:z.string().max(12000).default('')});
export const restructureSchema=z.object({revision:z.number().int().positive(),jobIds:z.array(z.string().min(1)).min(1).max(100),jobs:z.array(specification).min(1).max(100)});
const requests=j=>[...new Set([...(j.sourceRequestIds||[]),...(j.sourceRequestId?[j.sourceRequestId]:[])])];
export function restructureJobs(block,input,mode){
 const ids=new Set(input.jobIds);
 if(ids.size!==input.jobIds.length)throw new Error('Duplicate JOB IDs');
 if(mode==='split'?(ids.size!==1||input.jobs.length<2):(ids.size<2||input.jobs.length!==1))throw new Error('Split requires one JOB and at least two replacements; merge requires at least two JOBs and one replacement');
 const originals=input.jobIds.map(id=>block.jobs.find(j=>j.id===id));
 if(originals.some(j=>!j))throw new Error('JOB not found in this scope');
 if(originals.some(j=>j.status!=='pending'))throw new Error('Only pending JOBs can be split or merged. Reopen work explicitly first.');
 const lineage=new Map();
 for(const j of originals){for(const old of j.sourceJobs||[])lineage.set(old.id,old);lineage.set(j.id,{id:j.id,title:j.title,description:j.description,createdAt:j.createdAt,resolution:j.resolution||'',sourceRequestIds:requests(j)});}
 if(lineage.size>1000)throw new Error('JOB history limit exceeded');
 const sourceRequestIds=[...new Set(originals.flatMap(requests))];
 const now=new Date().toISOString();
 const jobs=input.jobs.map(j=>({...j,id:crypto.randomUUID(),status:'pending',createdAt:now,resolution:'',sourceRequestIds,sourceRequestId:sourceRequestIds.length===1?sourceRequestIds[0]:undefined,sourceJobs:[...lineage.values()]}));
 const next=block.jobs.filter(j=>!ids.has(j.id));
 next.splice(block.jobs.findIndex(j=>ids.has(j.id)),0,...jobs);
 return {...block,jobs:next,userRequests:block.userRequests.map(r=>({...r,jobIds:[...new Set((r.jobIds||[]).flatMap(id=>ids.has(id)?jobs.map(j=>j.id):[id]))]}))};
}
