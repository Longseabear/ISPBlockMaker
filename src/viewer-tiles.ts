import {visibleSource,type Rect,type Point} from './viewer-camera.ts';
export const TILE_SIZE=512, TILE_HALO=16;
export function visibleTiles(area:Rect,preview:{width:number;height:number},zoom:number,offset:Point,viewport:{width:number;height:number}){
 const scale={x:preview.width/area.width*zoom,y:preview.height/area.height*zoom};
 const visible=visibleSource(area,preview,zoom,offset,viewport);
 if(!visible||Math.min(scale.x,scale.y)<1)return [];
 const tiles:Rect[]=[];
 for(let y=Math.floor(visible.y/TILE_SIZE)*TILE_SIZE;y<Math.ceil(visible.y+visible.height);y+=TILE_SIZE)
 for(let x=Math.floor(visible.x/TILE_SIZE)*TILE_SIZE;x<Math.ceil(visible.x+visible.width);x+=TILE_SIZE){
  tiles.push({x,y,width:Math.min(TILE_SIZE,area.width-x),height:Math.min(TILE_SIZE,area.height-y)});
 }
 return tiles;
}
export function paddedTile(tile:Rect,size:{width:number;height:number}):Rect{
 const x=Math.max(0,tile.x-TILE_HALO),y=Math.max(0,tile.y-TILE_HALO);
 return{x,y,width:Math.min(size.width,tile.x+tile.width+TILE_HALO)-x,height:Math.min(size.height,tile.y+tile.height+TILE_HALO)-y};
}
