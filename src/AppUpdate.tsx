import {useEffect,useState} from 'react';
import type {Api} from './types';
type Status={current:string;latest:string;available:boolean;releasesUrl:string;downloadUrl:string|null};
export function AppUpdate({api}:{api:Api}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 async function check(){setBusy(true);try{setStatus(await api<Status>('/app-update'));setError('');}catch(e){setStatus(null);const message=e instanceof Error?e.message:String(e);setError(/failed to fetch|fetch failed|networkerror/i.test(message)?'앱 서버에 연결하지 못했습니다. 서버가 실행 중인지 확인하고 페이지를 새로고침하세요.':message);}finally{setBusy(false);}}
 useEffect(()=>{void check();},[api]);
 return <div style={{position:'relative'}}><button onClick={()=>setOpen(v=>!v)}>{status?.available?'새 버전 '+status.latest:'업데이트'}</button>{open&&<section role="dialog" aria-label="앱 업데이트" style={{position:'absolute',right:0,top:'100%',zIndex:100,width:320,padding:20,background:'#18232b',border:'1px solid #526470',borderRadius:8}}><h3>앱 업데이트</h3>{status&&<p>설치 {status.current} · 최신 {status.latest}<br/>{status.available?'새 버전을 설치할 수 있습니다.':'설치된 버전보다 새로운 안정 릴리스가 없습니다.'}</p>}{error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>void check()}>{busy?'확인 중…':'다시 확인'}</button><p><a href="https://longseabear.github.io/ISPBlockMaker/" target="_blank" rel="noreferrer">설치 안내 페이지</a></p><p><a href="https://github.com/Longseabear/ISPBlockMaker/releases/latest" target="_blank" rel="noreferrer">설치·릴리스 페이지 열기</a></p>{status?.available&&status.downloadUrl&&<p><a href={status.downloadUrl}>최신 설치 파일 다운로드</a></p>}<small>설치 파일을 받은 뒤 작업을 저장하고 앱을 종료하여 설치하세요.</small></section>}</div>;
}
