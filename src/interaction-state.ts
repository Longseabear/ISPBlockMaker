type Message = {id:string};
type Conversation<I extends Message> = {id:string;items:I[]};
export function mergeInteraction<S extends {chats:Conversation<I>[]}, I extends Message>(previous:S,event:{state?:S;updates:{chatId:string;item:I}[]},reset=false):S {
 const base=event.state||previous,old=new Map(previous.chats.map(c=>[c.id,c]));
 const updates=new Map<string,Map<string,I>>();
 for(const {chatId,item} of event.updates){let group=updates.get(chatId);if(!group){group=new Map();updates.set(chatId,group);}group.set(item.id,item);}
 const chats=base.chats.map(c=>{
  const prior=old.get(c.id),changes=updates.get(c.id);
  if(!reset&&!changes&&c===prior)return c;
  let items=reset?[]:prior?.items||[];
  if(changes){const rest=new Map(changes);items=items.map(item=>{const next=rest.get(item.id);rest.delete(item.id);return next||item;});items.push(...rest.values());}
  return {...c,items};
 });
 return {...base,chats};
}
