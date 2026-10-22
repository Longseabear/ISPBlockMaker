// Line numbers describe the text actually returned, even when a single line is long.
export function evidenceWindow(lines,start,count,maxChars){
 if(start>=lines.length)throw Error('Requested line is beyond the document');
 const selected=lines.slice(start,start+count).join('\n');
 let text=selected.slice(0,maxChars);
 // Do not split a UTF-16 surrogate pair at the response boundary.
 if(text.length&&/[\uD800-\uDBFF]/u.test(text.at(-1)))text=text.slice(0,-1);
 const end=start+text.split('\n').length;
 return {text,start_line:start+1,end_line:end,partial_last_line:text.length<selected.length&&selected[text.length]!=='\n',truncated:start>0||text.length<selected.length||start+count<lines.length};
}
