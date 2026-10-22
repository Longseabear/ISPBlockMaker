import {z} from 'zod';
import {imageSpec} from './viewer-image.mjs';

const id=z.string().min(1).max(200);
const imageId=z.string().uuid();
const region={x:z.number().int().min(0),y:z.number().int().min(0),width:z.number().int().positive(),height:z.number().int().positive()};
const segment=value=>encodeURIComponent(value);

// Only this fixed catalogue can reach the existing validated application routes.
// Never expose a caller-supplied URL, method, authorization header or API body proxy.
export function registerLocalTools(tool,api,mutate){
 const get=(route)=>api('GET',route);
 const post=(route,body)=>api('POST',route,body);
 tool('get_block_context','Read an explicit block contract, documentation paths and implementation references.',{block_id:id},({block_id})=>get(`/api/context?blockId=${segment(block_id)}`));
 tool('get_diagram','Read a specific diagram by stable ID, independent of the selected UI tab.',{diagram_id:id},({diagram_id})=>get(`/api/graph?diagramId=${segment(diagram_id)}`));
 tool('present_board','Highlight and fit explicit blocks or edges. Delivery does not prove the UI applied the request; unsaved edits may defer it.',{block_ids:z.array(id).max(200),edge_ids:z.array(id).max(1000).default([]),message:z.string().max(500).default('')},({block_ids,edge_ids,message})=>post('/api/present',{view:'graph',blockIds:block_ids,edgeIds:edge_ids,message}),false);
 tool('present_report','Open a registered HTML report or visualization in the workspace UI.',{artifact_id:id,message:z.string().max(500).default('')},({artifact_id,message})=>post('/api/present',{view:'artifacts',artifactId:artifact_id,message}),false);
 tool('list_viewer_images','List registered images and crop requests as metadata. Does not send image pixels to the model.',{},()=>get('/api/viewer'));
 tool('get_viewer_state','Read live viewport metadata and saved view metadata, without image attachments.',{},()=>get('/api/viewer/view'));
 tool('import_viewer_image','Register an image file from an explicit path for display. RAW requires confirmed dimensions and pixel format in spec. Returns metadata only; use control_viewer to show it. Existing matching images are reused.',{path:z.string().min(1).max(4096),name:z.string().min(1).max(200).optional(),spec:imageSpec.optional()},input=>post('/api/viewer/images/import',{...input,reuse:true}),false);
 tool('control_viewer','Show a registered image, fit or zoom and center it. This displays pixels in the UI only, never as model image input. Inspect command status before claiming it applied.',{image_id:imageId,fit:z.boolean().optional(),zoom_percent:z.number().min(1).max(51200).optional(),center:z.object({x:z.number().min(0),y:z.number().min(0)}).optional(),pixel_values:z.boolean().optional(),message:z.string().max(4000).default('')},({image_id,zoom_percent,pixel_values,...rest})=>post('/api/viewer/commands',{...rest,imageId:image_id,zoomPercent:zoom_percent,pixelValues:pixel_values,show:true}),false);
 tool('get_viewer_command','Check whether a display command is pending, applied or failed.',{command_id:z.string().uuid()},({command_id})=>get(`/api/viewer/commands/${segment(command_id)}`));
 for(const operation of ['pixels','statistics'])tool(`get_image_${operation}`,operation==='pixels'?'Read numerical source pixels for a small region (at most 256 samples). No image attachment.':'Compute numerical statistics for an explicit source region. No image attachment.',{image_id:imageId,...region},({image_id,...area})=>{
  if(operation==='pixels'&&area.width*area.height>256)throw Error('Pixel region must contain at most 256 samples; use statistics for larger regions.');
  return get(`/api/viewer/images/${segment(image_id)}/${operation}?${new URLSearchParams(area)}`);
 });
 tool('get_crop_selection','Read user-selected crop metadata and file references without embedding binary content.',{},()=>get('/api/viewer/crop-selection'));
 tool('get_crop_statistics','Compute numerical statistics for the exact user-delivered crop selection. Does not consume it.',{selection_id:z.string().uuid(),black:z.number().finite().optional(),white:z.number().finite().optional()},({selection_id,...body})=>post(`/api/viewer/crop-selection/${selection_id}/statistics`,body));
 tool('get_crop_request','Read a crop request status and received regions without image attachments.',{crop_request_id:z.string().uuid()},({crop_request_id})=>get(`/api/viewer/requests/${crop_request_id}`));
 if(mutate){
  tool('request_viewer_crops','Ask the user to select and send crops in the viewer. Returns a pending request; poll get_crop_request until explicit delivery. Do not claim crops arrived merely because the request was displayed.',{request_id:z.string().uuid(),image_id:imageId,prompt:z.string().min(1).max(4000),purpose:z.enum(['analysis','white_balance','input']).default('analysis'),block_id:id.optional()},input=>mutate('request_viewer_crops',input,()=>post('/api/viewer/requests',{imageId:input.image_id,prompt:input.prompt,purpose:input.purpose,blockId:input.block_id,origin:'agent',show:true})),false);
  tool('acknowledge_crop_selection','Mark the exact delivered selection consumed only after handling it. A stale selection ID is rejected.',{request_id:z.string().uuid(),selection_id:z.string().uuid(),resolution:z.string().max(4000)},input=>mutate('acknowledge_crop_selection',input,()=>post(`/api/viewer/crop-selection/${input.selection_id}/ack`,{resolution:input.resolution})),false);
 }
 tool('list_harness_runs','List workspace harness execution states.',{},()=>get('/api/harness/runs'));
 tool('get_harness_run','Inspect one harness run and its current step.',{run_id:id},({run_id})=>get(`/api/harness/runs/${segment(run_id)}`));
}

export function localApiAdapter({origin,token,fetchImpl=fetch}){
 const base=new URL(origin);
 if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password)throw Error('Local API adapter requires a loopback HTTP origin');
 return async(method,route,body)=>{
  if(!route.startsWith('/api/')||route.includes('\\'))throw Error('Invalid local API route');
  const url=new URL(route,base);
  if(url.origin!==base.origin)throw Error('Invalid local API origin');
  const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024)throw Error('Response exceeds MCP limit; use a narrower query');chunks.push(value);}}
  finally{await reader.cancel();reader.releaseLock();}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error(`Local API returned invalid JSON (HTTP ${response.status})`);}
  if(!response.ok)throw Error(String(value.error||`Local API error ${response.status}`).slice(0,2000));
  return value;
 };
}
