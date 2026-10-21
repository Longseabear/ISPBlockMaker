// Same-origin iframe boundary keeps upstream React/CSS isolated from the Board.
const pending = new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export function request(action:string,payload:unknown={}):Promise<any>{
 const id=crypto.randomUUID();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('연결 응답이 없습니다. 전송 상태를 확인한 뒤 다시 시도하세요.'));},120000);
  pending.set(id,{resolve,reject,timer});
  parent.postMessage({channel:'isp-cloudcli',id,action,payload},location.origin);
 });
}
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data?.channel!=='isp-cloudcli-result')return;
 const item=pending.get(event.data.id);if(!item)return;
 clearTimeout(item.timer);pending.delete(event.data.id);
 if(event.data.error)item.reject(new Error(event.data.error));else item.resolve(event.data.value);
});
