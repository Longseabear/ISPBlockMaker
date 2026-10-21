async page => {
 await page.reload();
 const ui=page.frameLocator('iframe.cloudcli-frame');
 await ui.locator('textarea').waitFor({state:'visible'});
 const calls=[];
 const mocked=/\/api\/interaction\/(send|answer|image|interrupt)$/;
 await page.route(mocked,async route=>{
  const action=route.request().url().split('/').pop();const payload=route.request().postDataJSON();calls.push({action,payload});
  const value=action==='image'?{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='}:{id:payload.chatId||'',ok:true};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.evaluate(()=>{
  const savedKey=Object.keys(localStorage).find(key=>key.startsWith('isp-chat:')&&key.endsWith('ui-work'));
  const selected=savedKey?localStorage.getItem(savedKey):'';
  window.cloudcliFixture={selected,workspace:'browser-test',provider:'claude',total:3,models:[],settings:[],engine:{engineVersion:'test'},error:'',requests:[],chat:{id:selected,busy:true,status:'inProgress',phase:'tool',items:[
   {id:'u',type:'userMessage',text:'Show a graph'},
   {id:'a',type:'agentMessage',text:'## Result\n\n```python\nprint(1)\n```\n\n$$SNR = 20 \\log_{10}(S/N)$$\n\n![sample](sample.png)',status:'completed'},
   {id:'t',type:'claudeToolCall',tool:'Bash',input:{command:'python snr.py'},status:'inProgress'}
  ]}};
  document.querySelector('iframe.cloudcli-frame').contentWindow.postMessage({channel:'isp-cloudcli-state',view:window.cloudcliFixture},location.origin);
 });
 await ui.getByRole('heading',{name:'Result'}).waitFor();
 await ui.locator('.katex').first().waitFor();
 await ui.locator('img[alt=sample]').waitFor();
 await ui.locator('img[alt=sample]').click();
 if(await ui.locator('img[alt=sample]').count()<2)throw Error('Image lightbox did not open');
 await ui.locator('body').press('Escape');
 await ui.locator('textarea').fill('queued followup');
 await ui.locator('textarea').press('Enter');
 await ui.getByText('queued followup',{exact:true}).waitFor();
 if(calls.filter(x=>x.action==='send').length!==0)throw Error('Queued message sent while busy');
 await page.evaluate(()=>{
  const v=window.cloudcliFixture;v.chat.busy=false;v.chat.status='completed';
  document.querySelector('iframe.cloudcli-frame').contentWindow.postMessage({channel:'isp-cloudcli-state',view:v},location.origin);
 });
 await ui.getByText('queued followup',{exact:true}).waitFor({state:'hidden'});
 const sends=calls.filter(x=>x.action==='send').map(x=>x.payload.text);
 if(sends.length!==1||sends[0]!=='queued followup')throw Error('Queue did not send exactly once');
 await page.evaluate(()=>{
  const v=window.cloudcliFixture;v.requests=[{id:'approval',method:'claude/requestApproval',params:{chatId:'fixture',reason:'Write file?',input:{file_path:'test.txt'},availableDecisions:['accept','decline','cancel']}}];
  document.querySelector('iframe.cloudcli-frame').contentWindow.postMessage({channel:'isp-cloudcli-state',view:v},location.origin);
 });
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/interaction/answer')),ui.getByRole('button',{name:'거절',exact:true}).click()]);
 const decision=calls.find(x=>x.action==='answer').payload.decision;
 if(decision!=='decline')throw Error('Approval decision corrupted');
 await ui.getByRole('button',{name:'Select model and reasoning effort'}).click();
 await ui.getByText('high',{exact:true}).click();
 await ui.locator('textarea').fill('/init');
 await ui.getByTitle('/init',{exact:true}).waitFor();
 await ui.locator('textarea').press('Enter');
 if((await ui.locator('textarea').inputValue()).trim()!=='/init')throw Error('Command selection failed');
 await page.getByRole('button',{name:'Report',exact:true}).click();
 if(!await ui.locator('textarea').isVisible())throw Error('Chat disappeared when opening report');
 await page.getByRole('button',{name:'Board',exact:true}).click();
 await ui.locator('textarea').fill('');
 await page.screenshot({path:'output/playwright/cloudcli-fixture.png'});
 await page.unroute(mocked);
 await page.reload();
 return {markdown:true,math:true,imageLightbox:true,queueExactlyOnce:true,approval:true,effort:true,slashMenu:true,reportAlongsideChat:true};
}
