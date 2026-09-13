import {useState} from 'react';
import type {Project} from './types';
export function JobsBoard({project,onOpen}:{project:Project;onOpen:(id:string|null)=>void}){
 const [filter,setFilter]=useState('remaining'),[query,setQuery]=useState('');
 const scopes=[{id:null,name:'전체 그래프',...project.globalWork},...project.blocks];
 const jobs=scopes.flatMap(s=>(s.jobs||[]).map(job=>({...job,scope:s.id,scopeName:s.name})));
 const remaining=jobs.filter(j=>j.status!=='done');
 const shown=jobs.filter(j=>(filter==='all'||(filter==='remaining'?j.status!=='done':j.status===filter))&&`${j.title} ${j.description} ${j.scopeName}`.toLowerCase().includes(query.toLowerCase()));
 return <section className="work-board"><header><h1>JOB Queue</h1><p>전체 그래프와 모든 블록의 작업 · 남음 {remaining.length} · 진행 중 {jobs.filter(j=>j.status==='in_progress').length}</p></header><div className="work-controls"><input aria-label="JOB 검색" placeholder="블록·요청·작업 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="JOB 상태" value={filter} onChange={e=>setFilter(e.target.value)}><option value="remaining">남은 JOB</option><option value="pending">대기</option><option value="in_progress">진행 중</option><option value="done">완료</option><option value="all">전체</option></select></div>
 {scopes.some(s=>s.userRequests?.some(r=>r.status==='pending'))&&<details><summary>아직 JOB으로 나누지 않은 요청 {scopes.reduce((n,s)=>n+(s.userRequests?.filter(r=>r.status==='pending').length||0),0)}개</summary>{scopes.flatMap(s=>(s.userRequests||[]).filter(r=>r.status==='pending').map(r=><article key={`${s.id}:${r.id}`}><strong>{s.name}</strong><p>{r.text}</p><button onClick={()=>onOpen(s.id)}>요청 열기</button></article>))}</details>}
 {!shown.length&&<p role="status">{filter==='remaining'&&!query?'남은 JOB이 없습니다.':'조건에 맞는 JOB이 없습니다.'}</p>}
 {shown.sort((a,b)=>Number(b.status==='in_progress')-Number(a.status==='in_progress')||a.createdAt.localeCompare(b.createdAt)).map(j=><article key={`${j.scope}:${j.id}`}><small>{j.scopeName} · {j.status==='in_progress'?'진행 중':j.status==='done'?'완료':'대기'}</small><h3>{j.title}</h3><p>{j.description}</p>{j.resolution&&<p>{j.resolution}</p>}<button onClick={()=>onOpen(j.scope)}>요청 / JOB 관리</button></article>)}
 </section>;
}
