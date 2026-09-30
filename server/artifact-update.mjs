import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';

export const artifactUpdateSchema=z.object({
  expectedFile:z.string().min(1).max(200),
  kind:z.enum(['html','png','jpeg','webp']),
  content:z.string().min(1).max(15*1024*1024),
  title:z.string().min(1).max(150).optional(),
}).strict();

export function updateArtifact(store,directory,id,body){
  const input=artifactUpdateSchema.parse(body);
  const previous=store.get().artifacts.find(a=>a.id===id);
  if(!previous)throw Object.assign(new Error('리포트를 찾을 수 없습니다.'),{status:404});
  if(previous.file!==input.expectedFile)throw Object.assign(new Error('리포트가 변경되었습니다. 최신 내용을 확인하고 병합하세요.'),{status:409});
  if(input.kind!==previous.kind)throw new Error('기존 리포트와 같은 파일 형식으로 갱신하세요.');
  const bytes=Buffer.from(input.content,'base64');
  if(!bytes.length||bytes.length>10*1024*1024)throw new Error('결과물은 10MB 이하여야 합니다.');
  const file=`${crypto.randomUUID()}.${input.kind}`;
  fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx'});
  let artifact;
  try {artifact=store.updateArtifact(id,input.expectedFile,{file,updatedAt:new Date().toISOString(),...(input.title===undefined?{}:{title:input.title})});}
  catch(error){fs.unlinkSync(path.join(directory,file));throw error;}
  // The new filename also invalidates the browser's currently rendered result.
  if(path.basename(previous.file)===previous.file&&!store.get().artifacts.some(a=>a.file===previous.file)){
    try{fs.unlinkSync(path.join(directory,previous.file));}catch{}
  }
  return artifact;
}
