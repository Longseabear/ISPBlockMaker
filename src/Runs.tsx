
import {useEffect,useState} from 'react';
import './runs.css';
type Recipe={id:string;title:string;description:string;executable:string;args:string[];cwd:string;parameters:Record<string,{description:string;required?:boolean;default?:string}>};
type Entry={recipe:Recipe;hash:string};
type Api=<T=any>(url:string,body?:unknown,method?:string)=>Promise<T>;
const starter={version:1,id:'image-quality-check',title:'Image quality check',description:'',executable:'python',args:['image_quality_check_v1.py','--input','{{input}}'],cwd:'.',blockIds:[],parameters:{input:{description:'Input image path',required:true}},expectedOutputs:[],timeoutMs:60000};
export function Runs({api,onRun}:{api:Api;onRun:(session:{sessionId:string;agent:string;blockId:string})=>void}){
 const [items,setItems]=useState<Entry[]>([]),[selected,setSelected]=useState(''),[values,setValues]=useState<Record<string,Record<string,string>>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [editor,setEditor]=useState<{hash:string|null;text:string;id?:string}|null>(null);
 const entry=items.find(x=>x.recipe.id===selected),recipe=entry?.recipe;
 async function refresh(){try{const data=await api<Entry[]>('/recipes');setItems(data);setSelected(id=>data.some(x=>x.recipe.id===id)?id:data[0]?.recipe.id||'');}catch(e){setError(String(e));}}
 useEffect(()=>{void refresh();},[api]);
 async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}}
 const parameters=Object.fromEntries(Object.entries(recipe?.parameters||{}).map(([name,def])=>[name,values[selected]?.[name]??def.default??'']));
 return <section className="runs-view"><header><h2>Runs</h2><span>등록한 스크립트를 파라미터와 함께 다시 실행합니다.</span><button disabled={busy} onClick={()=>void refresh()}>새로고침</button><button onClick={()=>setEditor({hash:null,text:JSON.stringify(starter,null,2)})}>등록</button></header>
 {error&&<p role="alert">{error}</p>}
 {editor?<div className="run-editor"><h3>{editor.hash?'실행 설정 수정':'실행 설정 등록'}</h3><p>에이전트는 isp recipe-save로 등록할 수 있습니다. parameters에 정의한 항목만 실행 화면에 표시됩니다.</p><textarea aria-label="실행 설정 JSON" value={editor.text} onChange={e=>setEditor({...editor,text:e.target.value})}/><button disabled={busy} onClick={()=>void action(async()=>{const spec=JSON.parse(editor.text);if(editor.id&&spec.id!==editor.id)throw Error('수정할 때 ID는 유지하세요.');await api('/recipes',{recipe:spec,expectedHash:editor.hash});setEditor(null);await refresh();setSelected(spec.id);})}>저장</button><button disabled={busy} onClick={()=>setEditor(null)}>취소</button></div>:
 <><select aria-label="실행 스크립트" value={selected} onChange={e=>setSelected(e.target.value)}>{items.map(x=><option key={x.recipe.id} value={x.recipe.id}>{x.recipe.title}</option>)}</select>
 {recipe&&entry?<article><h3>{recipe.title}</h3><p>{recipe.description}</p><code>{recipe.executable} {recipe.args.join(' ')}</code><p>작업 폴더: {recipe.cwd} (project 기준)</p>
 <div className="run-parameters">{Object.entries(recipe.parameters).map(([name,def])=><label key={name}><strong>{name}{def.required?' *':''}</strong><span>{def.description}</span><input aria-label={name} value={parameters[name]} onChange={e=>setValues({...values,[selected]:{...values[selected],[name]:e.target.value}})}/></label>)}</div>
 <div className="run-actions"><button disabled={busy||Object.entries(recipe.parameters).some(([name,def])=>def.required&&!parameters[name])} onClick={()=>void action(async()=>{const session=await api<{sessionId:string;agent:string;blockId:string}>('/recipes/'+recipe.id+'/launch',{parameters,expectedHash:entry.hash});onRun(session);})}>터미널에서 실행</button><button disabled={busy} onClick={()=>setEditor({hash:entry.hash,id:recipe.id,text:JSON.stringify(recipe,null,2)})}>수정</button><button disabled={busy} onClick={()=>{if(window.confirm('실행 등록을 제거할까요? 스크립트 파일은 유지됩니다.'))void action(async()=>{await api('/recipes/'+recipe.id,{expectedHash:entry.hash},'DELETE');await refresh();});}}>제거</button></div><small>새 터미널에서 실행하며 출력과 오류가 실시간으로 표시됩니다. 실행 후에도 터미널은 남습니다.</small></article>:<p>등록된 실행이 없습니다. 에이전트에게 스크립트를 Runs에 등록해 달라고 요청하세요.</p>}</>}
 </section>;
}
