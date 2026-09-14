import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';

export function installViewerSession(app,{current,present,read,write,findImage,folder}) {
  const point=z.object({x:z.number().finite().nonnegative(),y:z.number().finite().nonnegative()});
  const region=point.extend({width:z.number().finite().positive(),height:z.number().finite().positive()});
  const highlights=z.array(region.extend({label:z.string().max(120).default('')})).max(20);
  const render=z.object({mode:z.enum(['color','gray','cfa','simple']),gamma:z.number().min(.1).max(5),black:z.number().finite(),white:z.number().finite()}).refine(v=>v.white>v.black,'White must exceed black');
  const view=z.object({imageId:z.string().uuid(),render,zoom:z.number().positive().max(100),area:region,visible:region,highlights,selection:region.optional()});
  const checkRegion=(r,s)=>{if(r.x+r.width>s.width+.01||r.y+r.height>s.height+.01)throw new Error('View region is outside the source image');};
  const checkView=v=>{const image=findImage(v.imageId);checkRegion(v.area,image.spec);checkRegion(v.visible,image.spec);v.highlights.forEach(r=>checkRegion(r,image.spec));return image;};
  let live=null,liveWorkspace='';
  app.get('/api/viewer/view',(req,res)=>res.json({live:liveWorkspace===current().workspace?live:null,snapshots:read('views').slice().reverse()}));
  app.post('/api/viewer/view',(req,res)=>{
    const input=view.extend({sessionId:z.string().uuid()}).parse(req.body);checkView(input);
    liveWorkspace=current().workspace;live={...input,updatedAt:new Date().toISOString()};res.json(live);
  });
  app.post('/api/viewer/commands',(req,res)=>{
    const input=z.object({imageId:z.string().uuid(),zoom:z.number().min(.1).max(8).optional(),center:point.optional(),fit:z.boolean().optional(),render:render.optional(),highlights:highlights.optional(),message:z.string().max(4000).default(''),show:z.boolean().default(true)}).parse(req.body);
    const image=findImage(input.imageId);if(input.center&&(input.center.x>=image.spec.width||input.center.y>=image.spec.height))throw new Error('Center is outside the source image');
    input.highlights?.forEach(r=>checkRegion(r,image.spec));
    const command={...input,id:crypto.randomUUID(),status:'pending',createdAt:new Date().toISOString()};
    write('commands',[...read('commands').slice(-99),command]);
    res.status(201).json({...command,delivered:input.show?present('',input.message,command.id):0});
  });
  const command=id=>{const c=read('commands').find(c=>c.id===id);if(!c)throw new Error('Viewer command not found');return c;};
  app.get('/api/viewer/commands/:id',(req,res)=>res.json(command(req.params.id)));
  app.post('/api/viewer/commands/:id/show',(req,res)=>{const c=command(req.params.id);c.status='pending';delete c.acknowledgedAt;write('commands',read('commands').map(x=>x.id===c.id?c:x));res.json({delivered:present('',c.message,c.id)});});
  app.post('/api/viewer/commands/:id/ack',(req,res)=>{
    const c=command(req.params.id),input=z.object({status:z.enum(['applied','failed']),error:z.string().max(2000).optional(),sessionId:z.string().uuid()}).parse(req.body);
    Object.assign(c,input,{acknowledgedAt:new Date().toISOString()});write('commands',read('commands').map(x=>x.id===c.id?c:x));res.json(c);
  });
  app.post('/api/viewer/views',(req,res)=>{
    const input=z.object({view,note:z.string().max(12000).default(''),png:z.string().max(12*1024*1024)}).parse(req.body);
    const image=checkView(input.view),items=read('views');if(items.length>=100)throw new Error('저장 화면은 최대 100개입니다. 이전 화면을 제거하세요.');
    if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.png))throw new Error('PNG image required');
    const bytes=Buffer.from(input.png.split(',')[1],'base64');
    if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>2048||height>2048)throw new Error('View PNG must fit within 2048×2048');
    const id=crypto.randomUUID(),dir=path.join(folder(),'views',id);fs.mkdirSync(dir,{recursive:true});
    const item={id,createdAt:new Date().toISOString(),note:input.note,view:input.view,source:{imageId:image.id,sha256:image.sha256,spec:image.spec},width,height,coordinateSystem:'zero-based source pixels; exclusive right/bottom; display screenshot, not RAW crop',paths:{image:path.join(dir,'view.png'),metadata:path.join(dir,'metadata.json')}};
    fs.writeFileSync(item.paths.image,bytes);fs.writeFileSync(item.paths.metadata,JSON.stringify(item,null,2));write('views',[...items,item]);res.status(201).json(item);
  });
  const snapshot=id=>{const s=read('views').find(s=>s.id===id);if(!s)throw new Error('Saved view not found');return s;};
  app.get('/api/viewer/views/:id',(req,res)=>res.json(snapshot(req.params.id)));
  app.get('/api/viewer/views/:id/image',(req,res)=>{const s=snapshot(req.params.id);res.type('png').sendFile(path.join(folder(),'views',s.id,'view.png'));});
  app.get('/api/viewer/views/:id/attachment',(req,res)=>{
    const s=snapshot(req.params.id);
    if(req.query.vision!=='true')return res.json({snapshot:s,imageSupported:false,instruction:'Use paths.image with your available image-reading tool. Only request vision=true if the receiving integration supports image content.'});
    res.json({snapshot:s,content:[{type:'text',text:JSON.stringify({...s,paths:undefined})},{type:'image',mimeType:'image/png',data:fs.readFileSync(path.join(folder(),'views',s.id,'view.png')).toString('base64')}]});
  });
  app.delete('/api/viewer/views/:id',(req,res)=>{const s=snapshot(req.params.id);write('views',read('views').filter(x=>x.id!==s.id));for(const f of ['view.png','metadata.json'])fs.rmSync(path.join(folder(),'views',s.id,f),{force:true});res.json({removed:s.id});});
}
