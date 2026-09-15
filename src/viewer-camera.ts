export type Point={x:number;y:number};
export type Rect=Point&{width:number;height:number};

export function zoomAround(offset:Point,oldZoom:number,newZoom:number,pointer:Point):Point {
  return {x:pointer.x-(pointer.x-offset.x)*newZoom/oldZoom,y:pointer.y-(pointer.y-offset.y)*newZoom/oldZoom};
}
export function visibleSource(area:Rect,preview:{width:number;height:number},zoom:number,offset:Point,viewport:{width:number;height:number}):Rect|null {
  const width=preview.width*zoom,height=preview.height*zoom;
  const left=Math.max(0,-offset.x),top=Math.max(0,-offset.y);
  const right=Math.min(width,viewport.width-offset.x),bottom=Math.min(height,viewport.height-offset.y);
  if(width<=0||height<=0||right<=left||bottom<=top)return null;
  return {x:area.x+left/width*area.width,y:area.y+top/height*area.height,width:(right-left)/width*area.width,height:(bottom-top)/height*area.height};
}
