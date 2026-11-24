import crypto from 'node:crypto';
import {z} from 'zod';

// Separate credentials identify connections, not model names or caller-supplied IDs.
export class McpAgents {
 constructor({changed=()=>{},now=Date.now}={}){this.records=new Map();this.keys=new Map();this.changed=changed;this.now=now;}
 info(a){return {id:a.id,label:a.label,status:a.revoked?'disconnected':this.now()-a.seen>120000?'unconfirmed':'connected',lastSeen:new Date(a.seen).toISOString()};}
 list(){return [...this.records.values()].map(a=>this.info(a));}
 get(id){const a=this.records.get(id);return a?this.info(a):{id,label:'연결 종료',status:'disconnected'};}
 issue(label,key){
  label=z.string().trim().min(1).max(120).parse(label);
  const existing=key&&this.records.get(this.keys.get(key));
  if(existing){existing.label=label;existing.seen=this.now();if(existing.revoked){existing.revoked=false;existing.token=crypto.randomBytes(32).toString('hex');this.changed();}return {id:existing.id,token:existing.token,label};}
  if(this.records.size>=128)throw Error('에이전트 연결 한도(128개)입니다. 사용하지 않는 연결을 삭제하세요.');
  const a={id:crypto.randomUUID(),label,token:crypto.randomBytes(32).toString('hex'),seen:this.now(),revoked:false};this.records.set(a.id,a);if(key)this.keys.set(key,a.id);this.changed();return {id:a.id,token:a.token,label};
 }
 authenticate(token){const a=[...this.records.values()].find(a=>!a.revoked&&a.token===token);if(!a)return null;a.seen=this.now();return {kind:'agent',id:a.id,label:a.label};}
 revoke(id){const a=this.records.get(id);if(a){a.revoked=true;a.token='';this.changed();}return {ok:true};}
 forget(id){this.revoke(id);this.records.delete(id);for(const [key,value] of this.keys)if(value===id)this.keys.delete(key);this.changed();}
 clear(){this.records.clear();this.keys.clear();this.changed();}
}
