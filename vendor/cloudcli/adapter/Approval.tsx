import {useState} from 'react';
export function Approval({request,submit}:{request:any;submit:(body:unknown)=>Promise<void>}){
 const [answers,setAnswers]=useState<Record<string,string[]>>({}),[custom,setCustom]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
 async function send(body:unknown){setBusy(true);try{await submit(body);}catch{/* Parent displays the error; leave this request actionable. */}finally{setBusy(false);}}
 const questions=request.params.questions;
 const value=(id:string)=>custom[id]?.trim()?[...(answers[id]||[]),custom[id].trim()]:answers[id]||[];
 return <section className="isp-approval"><strong>{questions?'답변이 필요합니다':'작업 승인 요청'}</strong>
 {request.params.reason&&<p>{request.params.reason}</p>}{request.params.command&&<pre>{request.params.command}</pre>}
 {request.params.input!=null&&<pre>{JSON.stringify(request.params.input,null,2)}</pre>}
 {request.params.cwd&&<small>작업 폴더: {request.params.cwd}</small>}{request.params.grantRoot&&<p>변경 경로: {request.params.grantRoot}</p>}
 {questions?.map(q=><fieldset key={q.id}><legend>{q.question}{q.multiSelect?' (복수 선택 가능)':''}</legend>{q.options?.map(o=><button key={o.label} type="button" aria-pressed={answers[q.id]?.includes(o.label)||false} onClick={()=>{if(!q.multiSelect)setCustom(c=>({...c,[q.id]:''}));setAnswers(a=>({...a,[q.id]:q.multiSelect?(a[q.id]?.includes(o.label)?a[q.id].filter(v=>v!==o.label):[...(a[q.id]||[]),o.label]):[o.label]}));}} title={o.description}>{o.label}</button>)}<input aria-label={q.question} placeholder="직접 답변 입력" value={custom[q.id]||''} onChange={e=>{setCustom(c=>({...c,[q.id]:e.target.value}));if(!q.multiSelect)setAnswers(a=>({...a,[q.id]:[]}));}}/></fieldset>)}
 <div>{questions?<><button disabled={busy||questions.some(q=>!value(q.id).length)} onClick={()=>void send({id:request.id,answers:Object.fromEntries(questions.map(q=>[q.id,value(q.id)]))})}>답변 보내기</button>{request.method.startsWith('claude/')&&<button disabled={busy} onClick={()=>void send({id:request.id,decision:'cancel'})}>취소</button>}</>:['accept','decline','cancel'].filter(d=>!request.params.availableDecisions||request.params.availableDecisions.includes(d)).map(d=><button key={d} disabled={busy} onClick={()=>void send({id:request.id,decision:d})}>{d==='accept'?'이번 작업 승인':d==='decline'?'거절':'취소'}</button>)}</div></section>;
}
