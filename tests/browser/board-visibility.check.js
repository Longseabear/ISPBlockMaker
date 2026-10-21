async page => {
 await page.reload();await page.waitForTimeout(500);
 const viewport=page.locator('.react-flow__viewport');
 const close=page.getByRole('button',{name:'Close block details'});
 if(await close.isVisible())await close.click();
 const original=await viewport.getAttribute('style');
 for(let i=0;i<24;i++){
  await page.locator('.node-description').nth(i%2).click();
  if(i%3===0){const separator=page.getByRole('separator',{name:'그래프와 상세 높이 조절'});await separator.focus();await separator.press(i%2?'ArrowUp':'ArrowDown');}
  await page.waitForTimeout(40);
  const hidden=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.some(node=>getComputedStyle(node).visibility==='hidden'));
  if(hidden)throw Error('Hidden node after click '+i);
  await close.click();await page.waitForTimeout(40);
  if(await viewport.getAttribute('style')!==original)throw Error('Viewport not restored '+i);
  for(const node of await page.locator('.node-description').all())if(!await node.isVisible())throw Error('Node invisible after close '+i);
 }
 return {cycles:24,allNodesVisible:true,viewportRestored:true};
}
