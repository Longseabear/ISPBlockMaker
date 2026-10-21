import type {Port} from './types';
export function PortNames({value,onChange}:{value:string;onChange:(value:string)=>void}){
 let data:{inputs:Port[];outputs:Port[]};try{data=JSON.parse(value);if(!Array.isArray(data.inputs)||!Array.isArray(data.outputs))return null;}catch{return null;}
 return <section className="port-name-editor"><h3>포트 표시 이름</h3><p>ID와 연결은 유지하고 화면에 보이는 이름만 변경합니다.</p>{(['inputs','outputs'] as const).map(side=><div key={side}><h4>{side==='inputs'?'입력':'출력'}</h4>{data[side].map((port,index)=><label key={port.id}><code>{port.id}</code><input aria-label={side+' '+port.id+' 표시 이름'} value={port.name} onChange={e=>onChange(JSON.stringify({...data,[side]:data[side].map((p,i)=>i===index?{...p,name:e.target.value}:p)},null,2))}/></label>)}</div>)}</section>;
}
