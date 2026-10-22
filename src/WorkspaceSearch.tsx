import {useEffect,useRef,useState} from 'react';
import {Search} from 'lucide-react';
import type {Api,Project} from './types';
import './workspace-search.css';
type Hit={id:string;title:string;type:string;path?:string;field?:string;block_id?:string;hash:string;excerpt:string;start_line:number;end_line:number;truncated:boolean};
type Results={total:number;revision:number;results:Hit[]};
type Document={id:string;title:string;text:string;start_line:number;end_line:number;truncated:boolean;has_more:boolean;partial_last_line?:boolean};
type Query={query:string;mode:'all'|'any';diagram_id?:string;limit:number;offset:number};
export function WorkspaceSearch({api,project}:{api:Api;project:Project}){
 const [query,setQuery]=useState(''),[mode,setMode]=useState<'all'|'any'>('any'),[diagram,setDiagram]=useState(''),[submitted,setSubmitted]=useState<Query|null>(null);
 const [results,setResults]=useState<Results|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Hit|null>(null),[document,setDocument]=useState<Document|null>(null),[reading,setReading]=useState(false);
 const sequence=useRef(0),readSequence=useRef(0);
 useEffect(()=>{setResults(null);setSelected(null);setDocument(null);setError('');setSubmitted(null);setBusy(false);setReading(false);return()=>{sequence.current++;readSequence.current++;};},[api]);
 async function search(input:Query){const seq=++sequence.current;readSequence.current++;setBusy(true);setError('');setSelected(null);setDocument(null);setReading(false);setSubmitted(input);
  try{const value=await api<Results>('/search',input);if(seq===sequence.current)setResults(value);}catch(e){if(seq===sequence.current){setError(String(e));setResults(null);}}finally{if(seq===sequence.current)setBusy(false);}
 }
 async function read(hit:Hit,start=hit.start_line){const seq=++readSequence.current;setSelected(hit);setDocument(null);setReading(true);setError('');
  try{const value=await api<Document>('/search/read',{document_id:hit.id,hash:hit.hash,start_line:start,max_lines:80});if(seq===readSequence.current)setDocument(value);}catch(e){if(seq===readSequence.current)setError(String(e));}finally{if(seq===readSequence.current)setReading(false);}
 }
 return <section className="workspace-search"><header><Search size={24}/><div><h1>Workspace Search</h1><p>Board · 문서 · 연결된 소스 · JOB의 근거를 검색합니다.</p></div></header>
  <form onSubmit={e=>{e.preventDefault();if(query.trim())void search({query:query.trim(),mode,...(diagram?{diagram_id:diagram}:{}),limit:20,offset:0});}}>
   <div className="search-query"><input aria-label="워크스페이스 검색어" value={query} maxLength={500} onChange={e=>setQuery(e.target.value)} placeholder={'노이즈 분산, "exact phrase", block ID'}/><button type="submit" disabled={busy||!query.trim()}>{busy?'검색 중…':'검색'}</button></div>
   <div className="search-filters"><label>범위<select value={diagram} onChange={e=>setDiagram(e.target.value)}><option value="">전체 다이어그램</option>{project.diagrams.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>단어 조건<select value={mode} onChange={e=>setMode(e.target.value as 'all'|'any')}><option value="any">하나 이상 일치</option><option value="all">모두 일치</option></select></label></div>
  </form>
  {error&&<p role="alert">{error}</p>}
  {results&&<p role="status">{results.total}개 문서 · r{results.revision}{results.total===0?' · 검색어 또는 범위를 바꿔보세요.':''}</p>}
  <div className="search-results">{results?.results.map(hit=><article key={hit.id} className={selected?.id===hit.id?'selected':''}><button className="search-hit" onClick={()=>void read(hit)}><strong>{hit.title}</strong><small>{hit.type} · {hit.path||hit.field||hit.id} · {hit.start_line}–{hit.end_line}행</small><pre>{hit.excerpt}</pre></button>{hit.block_id&&<button onClick={()=>{void api('/present',{view:'graph',blockIds:[hit.block_id],edgeIds:[],message:'검색 결과의 블록'}).catch(e=>setError(String(e)));}}>Board에서 보기</button>}
   {selected?.id===hit.id&&<div className="search-document">{reading?<p>문서를 읽는 중…</p>:document&&<><div><strong>근거 원문 · {document.start_line}–{document.end_line}행</strong><button onClick={()=>{readSequence.current++;setSelected(null);setDocument(null);}}>닫기</button></div><pre>{document.text}</pre>{document.partial_last_line?<small>긴 줄이 응답 한도에서 잘렸습니다. 원본 파일을 확인하세요.</small>:document.has_more&&<button onClick={()=>void read(hit,document.end_line+1)}>다음 부분</button>}</>}</div>}
  </article>)}</div>
  {results&&submitted&&<nav aria-label="검색 결과 페이지"><button disabled={busy||submitted.offset===0} onClick={()=>void search({...submitted,offset:Math.max(0,submitted.offset-20)})}>이전</button><span>{Math.floor(submitted.offset/20)+1}</span><button disabled={busy||submitted.offset+20>=results.total} onClick={()=>void search({...submitted,offset:submitted.offset+20})}>다음</button></nav>}
 </section>;
}
