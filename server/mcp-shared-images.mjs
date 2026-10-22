import fs from 'node:fs';
import {z} from 'zod';
import {safeGraphPath} from './graph-storage.mjs';
import {openImage,preview} from './viewer-image.mjs';

export function sharedImages(workspace){
 const file=safeGraphPath(workspace,'.isp/viewer/images.json');
 if(!fs.existsSync(file))return [];
 if(fs.statSync(file).size>1024*1024)throw Error('Image catalogue exceeds limit');
 return JSON.parse(fs.readFileSync(file,'utf8')).map(({id,name,spec,sha256})=>({id,name,spec,sha256}));
}
export function sharedImagePreview(workspace,id){
 z.string().uuid().parse(id);
 const image=sharedImages(workspace).find(image=>image.id===id);if(!image)throw Error('Shared image is unavailable');
 const file=safeGraphPath(workspace,`.isp/viewer/${id}.bin`),stat=fs.statSync(file);
 if(!stat.isFile()||stat.size>256*1024*1024)throw Error('Image is unavailable or exceeds the size limit');
 const result=preview(openImage(fs.readFileSync(file),image.spec),{fullFrame:true,maxDimension:512});
 if(result.png.length>2*1024*1024)throw Error('Image preview exceeds the transfer limit');
 return {metadata:{...image,width:result.width,height:result.height,note:'Display preview, maximum 512 pixels per side; not source numerical samples.'},data:result.png.toString('base64')};
}

export function registerSharedImageTools(server,{scope,list,read}){
 server.registerTool('list_shared_images',{description:'List only owner-selected image metadata. Does not send image pixels.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false}},async()=>{
  try{const images=list().filter(image=>scope.imageIds.includes(image.id));return {content:[{type:'text',text:JSON.stringify({images})}],structuredContent:{images}};}
  catch{return {isError:true,content:[{type:'text',text:'Shared image catalogue is unavailable'}]};}
 });
 server.registerTool('read_shared_image',{description:'Explicitly request an owner-selected 512-pixel image preview as native image input. Requires a vision-capable model. This does not control the owner’s viewer.',inputSchema:{image_id:z.string().uuid()},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false}},async({image_id})=>{
  try{if(!scope.imageIds.includes(image_id))throw Error('Shared image not found');const value=read(image_id);return {content:[{type:'text',text:JSON.stringify(value.metadata)},{type:'image',mimeType:'image/png',data:value.data}]};}
  catch{return {isError:true,content:[{type:'text',text:'Shared image is unavailable or not selected'}]};}
 });
}
