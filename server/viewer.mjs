import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import {z} from "zod";
import {openImage,preview,cropImage} from "./viewer-image.mjs";
import {installViewerSession} from "./viewer-session.mjs";

export function installViewer(app,{current,present}) {
  const id=value=>z.string().uuid().parse(value);
  const folder=()=>path.join(current().workspace,".isp","viewer");
  const read=name=>{const file=path.join(folder(),name+".json");return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):[];};
  const write=(name,value)=>{fs.mkdirSync(folder(),{recursive:true});const file=path.join(folder(),name+".json");fs.writeFileSync(file+".tmp",JSON.stringify(value));fs.renameSync(file+".tmp",file);};
  const findImage=value=>{const image=read("images").find(i=>i.id===id(value));if(!image)throw new Error("이미지를 찾을 수 없습니다.");return image;};
  const load=image=>{const file=path.join(folder(),image.id+".bin");if(!fs.existsSync(file))throw new Error("Viewer 원본이 없습니다. 원본 포함 번들을 사용하거나 이미지를 다시 등록하세요. 저장된 크롭은 다운로드할 수 있습니다.");return openImage(fs.readFileSync(file),image.spec);};
  installViewerSession(app,{current,present,read,write,findImage,folder});
  const register=(bytes,input)=>{
    if(!bytes.length||bytes.length>256*1024*1024)throw new Error("이미지는 최대 256MB입니다.");
    const images=read("images");
    const decoded=openImage(bytes,input.spec);
    if(input.reuse){const sha=crypto.createHash("sha256").update(bytes).digest("hex");const existing=images.find(i=>i.sha256===sha&&JSON.stringify(i.spec)===JSON.stringify(decoded.spec));if(existing){const original=path.join(folder(),existing.id+'.bin');if(!fs.existsSync(original))fs.writeFileSync(original,bytes,{flag:'wx'});return {...existing,reused:true};}}
    if(images.length>=200)throw new Error("Viewer 이미지 한도(200개)에 도달했습니다.");
    const image={id:crypto.randomUUID(),name:z.string().min(1).max(200).parse(input.name),spec:decoded.spec,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),createdAt:new Date().toISOString()};
    fs.mkdirSync(folder(),{recursive:true});fs.writeFileSync(path.join(folder(),image.id+".bin"),bytes);
    write("images",[...images,image]);return image;
  };
  const findRequest=value=>{const request=read("requests").find(r=>r.id===id(value));if(!request)throw new Error("크롭 요청을 찾을 수 없습니다.");return request;};
  app.get("/api/viewer",(req,res)=>res.json({images:read("images"),requests:read("requests")}));
  app.post("/api/viewer/images",express.raw({type:"application/octet-stream",limit:"256mb"}),(req,res)=>{
    const input=JSON.parse(decodeURIComponent(req.headers["x-image-metadata"]||"{}"));
    if(!Buffer.isBuffer(req.body))throw new Error("이미지 바이너리가 필요합니다.");
    res.status(201).json(register(req.body,input));
  });
  app.post("/api/viewer/images/import",(req,res)=>{
    const workspace=fs.realpathSync(current().workspace);
    const file=fs.realpathSync(path.resolve(workspace,z.string().min(1).parse(req.body.path)));
    // External image paths are read-only inputs; register stores a workspace-local copy.
    if(!fs.statSync(file).isFile()||fs.statSync(file).size>256*1024*1024)throw new Error("파일 크기/형식을 확인하세요.");
    res.status(201).json(register(fs.readFileSync(file),{name:req.body.name||path.basename(file),spec:req.body.spec,reuse:req.body.reuse===true}));
  });
  app.get("/api/viewer/images/:id/preview",(req,res)=>{
    const image=findImage(req.params.id);
    const mode=z.enum(["gray","color","cfa","simple"]).parse(req.query.mode||"color");
    const output=preview(load(image),{mode,gamma:Number(req.query.gamma??2.2),viewX:Number(req.query.viewX??0),viewY:Number(req.query.viewY??0),black:Number(req.query.black||0),white:req.query.white===undefined?2**image.spec.bitDepth-1:Number(req.query.white)});
    res.json({width:output.width,height:output.height,area:output.area,url:"data:image/png;base64,"+output.png.toString("base64")});
  });
  app.post("/api/viewer/requests",(req,res)=>{
    const input=z.object({imageId:z.string().uuid(),prompt:z.string().min(1).max(4000),blockId:z.string().optional(),show:z.boolean().default(true)}).parse(req.body);
    findImage(input.imageId);
    if(input.blockId&&!current().state.blocks.some(b=>b.id===input.blockId))throw new Error("블록을 찾을 수 없습니다.");
    const requests=read("requests");if(requests.length>=1000)throw new Error("크롭 요청 한도(1000개)에 도달했습니다.");
    const request={...input,id:crypto.randomUUID(),status:"pending",createdAt:new Date().toISOString(),revision:current().state.revision};
    write("requests",[...requests,request]);
    res.status(201).json({...request,delivered:input.show?present(request.id,input.prompt):0});
  });
  app.get("/api/viewer/requests/:id",(req,res)=>res.json(findRequest(req.params.id)));
  app.post("/api/viewer/requests/:id/crops",(req,res)=>{
    const request=findRequest(req.params.id);
    if(request.status==="cancelled")return res.status(409).json({error:"취소된 요청입니다. 새 크롭 요청을 선택하세요."});
    const input=z.object({id:z.string().uuid(),roi:z.object({x:z.number().int(),y:z.number().int(),width:z.number().int(),height:z.number().int()}),description:z.string().max(12000).default("")}).parse(req.body);
    const crops=request.crops||(request.result?[{...request.result,id:request.id,description:"",createdAt:request.completedAt}]:[]);
    if(crops.some(c=>c.id===input.id))return res.json({...request,crops});
    if(crops.length>=200)throw new Error("요청당 크롭은 최대 200개입니다.");
    const image=findImage(request.imageId),decoded=load(image),crop=cropImage(decoded,input.roi);
    const resultDir=path.join(folder(),"results",request.id,input.id);
    fs.mkdirSync(resultDir,{recursive:true});
    const local=file=>path.relative(current().workspace,path.join(resultDir,file)).split(path.sep).join("/");
    const result={id:input.id,description:input.description,createdAt:new Date().toISOString(),roi:input.roi,coordinateSystem:"zero-based source pixels; x/y inclusive; x+width/y+height exclusive",source:{imageId:image.id,sha256:image.sha256,spec:image.spec},output:crop.spec,paths:{crop:local("crop."+crop.extension),preview:local("preview.png"),metadata:local("metadata.json")},sha256:crypto.createHash("sha256").update(crop.bytes).digest("hex")};
    fs.writeFileSync(path.join(resultDir,"crop."+crop.extension),crop.bytes);
    fs.writeFileSync(path.join(resultDir,"preview.png"),preview(decoded,{roi:input.roi}).png);
    fs.writeFileSync(path.join(resultDir,"metadata.json"),JSON.stringify(result,null,2));
    request.crops=[...crops,result];request.result=request.crops[0];request.status="submitted";request.completedAt=result.createdAt;
    write("requests",read("requests").map(r=>r.id===request.id?request:r));res.status(201).json(request);
  });
  app.patch("/api/viewer/requests/:id/crops/:cropId",(req,res)=>{
    const request=findRequest(req.params.id),cropId=id(req.params.cropId);
    const input=z.object({description:z.string().max(12000),previousDescription:z.string().max(12000)}).parse(req.body);
    const crops=request.crops||(request.result?[{...request.result,id:request.id,description:"",createdAt:request.completedAt}]:[]);
    const crop=crops.find(c=>c.id===cropId);if(!crop)throw new Error("크롭 항목을 찾을 수 없습니다.");
    if((crop.description||"")!==input.previousDescription)return res.status(409).json({error:"다른 화면에서 설명을 변경했습니다. 최신 내용을 확인하세요."});
    crop.description=input.description;crop.updatedAt=new Date().toISOString();
    request.crops=crops;request.result=crops[0];
    const metadata=path.resolve(current().workspace,crop.paths.metadata);
    if(!metadata.startsWith(path.join(folder(),"results",request.id)+path.sep))throw new Error("잘못된 결과 경로입니다.");
    fs.writeFileSync(metadata,JSON.stringify(crop,null,2));
    write("requests",read("requests").map(r=>r.id===request.id?request:r));res.json(request);
  });
  app.delete("/api/viewer/requests/:id/crops/:cropId",(req,res)=>{
    const request=findRequest(req.params.id),cropId=id(req.params.cropId);
    const crops=request.crops||(request.result?[{...request.result,id:request.id,description:""}]:[]);
    const crop=crops.find(c=>c.id===cropId);if(!crop) return res.status(404).json({error:"이미 제거된 크롭입니다."});
    const remaining=crops.filter(c=>c.id!==cropId),staged=[];
    try {
      for(const relative of Object.values(crop.paths)){
        if(remaining.some(c=>Object.values(c.paths).includes(relative)))continue;
        const file=path.resolve(current().workspace,relative);
        if(!file.startsWith(path.join(folder(),"results",request.id)+path.sep))throw new Error("잘못된 결과 경로입니다.");
        if(fs.existsSync(file)){const temp=file+".delete-"+crypto.randomUUID();fs.renameSync(file,temp);staged.push({file,temp});}
      }
      request.crops=remaining;request.result=remaining[0];
      if(!remaining.length){request.status="pending";delete request.completedAt;}
      write("requests",read("requests").map(r=>r.id===request.id?request:r));
    }catch(error){for(const item of staged.reverse())fs.renameSync(item.temp,item.file);throw error;}
    const cleanupPending=[];
    for(const item of staged){try{fs.unlinkSync(item.temp);}catch{cleanupPending.push(path.basename(item.temp));}}
    res.json({...request,cleanupPending});
  });
  app.get("/api/viewer/requests/:id/files/:kind",(req,res)=>{
    const request=findRequest(req.params.id),kind=z.enum(["crop","preview","metadata"]).parse(req.params.kind);
    const result=req.query.cropId?(request.crops||[]).find(c=>c.id===id(req.query.cropId)):request.result;
    if(!result)throw new Error("아직 제출된 크롭이 없습니다.");
    const file=path.resolve(current().workspace,result.paths[kind]);
    if(!file.startsWith(path.join(folder(),"results",request.id)+path.sep))throw new Error("잘못된 결과 경로입니다.");
    res.download(file,path.basename(file),{dotfiles:"allow"});
  });
  app.post("/api/viewer/requests/:id/show",(req,res)=>{const request=findRequest(req.params.id);res.json({delivered:present(request.id,request.prompt)});});
  app.post("/api/viewer/requests/:id/cancel",(req,res)=>{
    const request=findRequest(req.params.id);if(request.status!=="pending")return res.status(409).json({error:"이미 완료된 요청입니다."});
    request.status="cancelled";request.completedAt=new Date().toISOString();write("requests",read("requests").map(r=>r.id===request.id?request:r));res.json(request);
  });
  app.post("/api/viewer/requests/:id/submit",(req,res)=>{
    const request=findRequest(req.params.id);if(request.status!=="pending")return res.status(409).json({error:"이미 완료된 요청입니다. 새 크롭 요청을 만드세요."});
    const image=findImage(request.imageId),decoded=load(image);
    const roi=z.object({x:z.number().int(),y:z.number().int(),width:z.number().int(),height:z.number().int()}).parse(req.body);
    const crop=cropImage(decoded,roi),resultDir=path.join(folder(),"results",request.id);
    fs.mkdirSync(resultDir,{recursive:true});
    const local=file=>path.relative(current().workspace,path.join(resultDir,file)).split(path.sep).join("/");
    const result={roi,coordinateSystem:"zero-based source pixels; x/y inclusive; x+width/y+height exclusive",source:{imageId:image.id,sha256:image.sha256,spec:image.spec},output:crop.spec,paths:{crop:local("crop."+crop.extension),preview:local("preview.png"),metadata:local("metadata.json")},sha256:crypto.createHash("sha256").update(crop.bytes).digest("hex")};
    fs.writeFileSync(path.join(resultDir,"crop."+crop.extension),crop.bytes);
    fs.writeFileSync(path.join(resultDir,"preview.png"),preview(decoded,{roi}).png);
    fs.writeFileSync(path.join(resultDir,"metadata.json"),JSON.stringify(result,null,2));
    request.status="submitted";request.completedAt=new Date().toISOString();request.result=result;
    write("requests",read("requests").map(r=>r.id===request.id?request:r));res.json(request);
  });
}
