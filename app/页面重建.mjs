// Page geometry uses PDF points; image analysis never changes the source page.
import {detectTableGrids,buildTables,paintTables} from './tables.mjs';
export const LAYOUT_VERSION = 'rebuild-5.2-geometry';
const median = values => { const a = values.filter(Number.isFinite).sort((a,b)=>a-b); return a.length ? a[Math.floor(a.length/2)] : 9; };
const overlap = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const bounds = rows => { const x=Math.min(...rows.map(r=>r.x)),y=Math.min(...rows.map(r=>r.y));return {x,y,width:Math.max(...rows.map(r=>r.x+r.width))-x,height:Math.max(...rows.map(r=>r.y+r.height))-y}; };
const expand = (r,n,page) => ({x:Math.max(0,r.x-n),y:Math.max(0,r.y-n),width:Math.min(page.width,r.x+r.width+n)-Math.max(0,r.x-n),height:Math.min(page.height,r.y+r.height+n)-Math.max(0,r.y-n)});

// PDF drawing order is unrelated to reading order. Attach small raised/lowered
// glyphs before assigning regions, then form lines in geometric order.
export function extractNativeRows(content,base,regions,transform){
  const fragments=content.items.filter(i=>i.str?.trim()).map(item=>{
    const tx=transform(base.transform,item.transform),height=Math.max(3,Math.hypot(tx[2],tx[3]));
    return {text:item.str.trim(),x:tx[4],y:tx[5]-height*.82,baseline:tx[5],width:Math.max(.5,item.width),height,
      rotated:Math.abs(tx[1])>Math.abs(tx[0])*.25,
      mathFont:/math|symbol|cmsy|cmex|stix/i.test(content.styles[item.fontName]?.fontFamily||'')};
  });
  const subs='₀₁₂₃₄₅₆₇₈₉',supers='⁰¹²³⁴⁵⁶⁷⁸⁹',attached=new Set();
  for(const small of [...fragments].sort((a,b)=>a.height-b.height)){
    if(small.rotated||!/^(?:\d{1,3}|st|nd|rd|th)$/.test(small.text))continue;
    const host=fragments.filter(big=>big!==small&&!attached.has(big)&&!big.rotated&&big.height>small.height*1.18&&big.height<small.height*2.5&&/[A-Za-z0-9]$/.test(big.text)&&small.x>=big.x+big.width-big.height*.15&&small.x-big.x-big.width<big.height*.45&&Math.abs(small.y-big.y)>big.height*.15&&Math.abs(small.baseline-big.baseline)<big.height*.65).sort((a,b)=>Math.abs(small.x-a.x-a.width)-Math.abs(small.x-b.x-b.width))[0];
    if(!host)continue;
    const alphabet=small.y>host.y?subs:supers;
    host.text+=/^[a-z]+$/.test(small.text)?small.text:small.text.replace(/\d/g,d=>alphabet[Number(d)]);host.width=Math.max(host.width,small.x+small.width-host.x);attached.add(small);
  }
  const rows=[];
  for(const item of fragments.filter(r=>!attached.has(r)).sort((a,b)=>a.y-b.y||a.x-b.x)){
    const region=regions.map(r=>({r,area:overlap(item,r)})).sort((a,b)=>b.area-a.area)[0]?.r;
    if(!region)continue;
    const row={...item,regionId:region.id,parts:[{...item}]};
    const line=rows.filter(other=>!row.rotated&&!other.rotated&&(other.regionId===row.regionId||row.x-other.x-other.width<6)&&Math.abs(other.baseline-row.baseline)<Math.max(row.height,other.height)*.25&&Math.max(row.height,other.height)/Math.min(row.height,other.height)<1.3&&row.x>=other.x+other.width-row.height*.6&&row.x-other.x-other.width<Math.max(row.height*2.3,20)).sort((a,b)=>b.x+b.width-a.x-a.width)[0];
    if(line){
      const gap=row.x-line.x-line.width;
      const separator=gap<row.height*.1&&!/\s$/.test(line.text)&&!/^\s/.test(row.text)?'':' ';
      line.text+=separator+row.text;line.parts.push(...row.parts);line.width=Math.max(line.width,row.x+row.width-line.x);line.mathFont||=row.mathFont;
    }else rows.push(row);
  }
  // PDF bullet glyphs are often private-use characters in a symbol font.
  for(const row of rows){if(/^[•▪◦]/u.test(row.text)){row.bullet=true;row.text=row.text.replace(/^[•▪◦]\s*/u,'')}}
  for(const row of rows)row.regionId=regions.map(r=>({r,area:overlap(row,r)})).sort((a,b)=>b.area-a.area)[0]?.r.id;
  return rows.filter(r=>r.text.trim());
}

export function analyzeRaster(image,page) {
  const unit=1.2,w=Math.ceil(page.width/unit),h=Math.ceil(page.height/unit),ink=new Uint8Array(w*h);
  const sx=image.width/w,sy=image.height/h;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let dark=0,samples=0;
    for(let dy=0;dy<sy;dy++)for(let dx=0;dx<sx;dx++){
      const px=Math.min(image.width-1,Math.floor(x*sx+dx)),py=Math.min(image.height-1,Math.floor(y*sy+dy)),i=(py*image.width+px)*4;
      if(image.data[i]+image.data[i+1]+image.data[i+2]<650)dark++;
      samples++;
    }
    ink[y*w+x]=dark/Math.max(1,samples)>.12?1:0;
  }
  // Close small horizontal gaps only: letters join into lines, text lines stay separate.
  const joined=ink.slice();
  for(let y=0;y<h;y++)for(let x=1;x<w-2;x++)if(ink[y*w+x-1]&& !ink[y*w+x]&&(ink[y*w+x+1]||ink[y*w+x+2]))joined[y*w+x]=1;
  const seen=new Uint8Array(w*h),components=[],bullets=[];
  for(let i=0;i<joined.length;i++){
    if(!joined[i]||seen[i])continue;
    const stack=[i];seen[i]=1;let x0=w,y0=h,x1=0,y1=0,count=0;
    while(stack.length){const p=stack.pop(),x=p%w,y=Math.floor(p/w);count++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){const nx=x+dx,ny=y+dy,q=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&joined[q]&&!seen[q]){seen[q]=1;stack.push(q)}}
    }
    const rect={x:x0*unit,y:y0*unit,width:(x1-x0+1)*unit,height:(y1-y0+1)*unit};
    if(count>=4&&rect.width>=2.4&&rect.width<=5&&rect.height>=2.4&&rect.height<=5&&count/((x1-x0+1)*(y1-y0+1))>.65)bullets.push(rect);
    if(count>25&&rect.height>=19&&rect.width>=20)components.push(rect);
  }
  const rules=[];
  for(let y=0;y<h;y++){
    let run=0,start=0;
    for(let x=0;x<=w;x++){if(x<w&&ink[y*w+x]){if(!run)start=x;run++}else{if(run*unit>page.width*.25)rules.push({x:start*unit,y:y*unit,width:run*unit,height:unit});run=0}}
  }
  const regions=[];
  function split(r,depth=0){
    if(depth>10||r.x1-r.x0<12||r.y1-r.y0<4){regions.push(r);return}
    const cols=new Float64Array(r.x1-r.x0),rows=new Float64Array(r.y1-r.y0);
    for(let y=r.y0;y<r.y1;y++){
      let total=0;for(let x=r.x0;x<r.x1;x++)total+=ink[y*w+x];
      if(total>(r.x1-r.x0)*.65)continue;
      rows[y-r.y0]=total;
      for(let x=r.x0;x<r.x1;x++)cols[x-r.x0]+=ink[y*w+x];
    }
    const gaps=(a,limit,min)=>{const out=[];let start=-1;for(let i=0;i<=a.length;i++){if(i<a.length&&a[i]<=limit){if(start<0)start=i}else if(start>=0){if(i-start>=min&&start>2&&i<a.length-2)out.push([start,i]);start=-1}}return out};
    const yg=gaps(rows,1,8/unit).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));
    if(yg.length){const mid=Math.floor((yg[0][0]+yg[0][1])/2)+r.y0;split({...r,y1:mid},depth+1);split({...r,y0:mid},depth+1);return}
    if((r.y1-r.y0)*unit>3){
      const xg=gaps(cols,Math.max(1,(r.y1-r.y0)*.012),11/unit).filter(g=>g[0]>cols.length*.17&&g[1]<cols.length*.84).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));
      if(xg.length){const mid=Math.floor((xg[0][0]+xg[0][1])/2)+r.x0;split({...r,x1:mid},depth+1);split({...r,x0:mid},depth+1);return}
    }
    let x0=r.x1,y0=r.y1,x1=r.x0,y1=r.y0;
    for(let y=r.y0;y<r.y1;y++)for(let x=r.x0;x<r.x1;x++)if(ink[y*w+x]){x0=Math.min(x0,x);x1=Math.max(x1,x+1);y0=Math.min(y0,y);y1=Math.max(y1,y+1)}
    if(x1>x0&&y1>y0)regions.push({...r,x0:Math.max(r.x0,x0-2),x1:Math.min(r.x1,x1+2),y0:Math.max(r.y0,y0-2),y1:Math.min(r.y1,y1+2)});
  }
  split({x0:Math.floor(8/unit),y0:0,x1:Math.min(w,Math.ceil((page.width-8)/unit)),y1:h});
  // Thin grey table borders disappear in the coarser segmentation bitmap.
  const gridUnit=.5,gw=Math.ceil(page.width/gridUnit),gh=Math.ceil(page.height/gridUnit),gridInk=new Uint8Array(gw*gh);
  for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
    const px=Math.min(image.width-1,Math.floor(x*gridUnit*image.width/page.width)),py=Math.min(image.height-1,Math.floor(y*gridUnit*image.height/page.height));
    const i=(py*image.width+px)*4;gridInk[y*gw+x]=image.data[i]+image.data[i+1]+image.data[i+2]<735?1:0;
  }
  return {regions:regions.map((r,i)=>({id:i,x:r.x0*unit,y:r.y0*unit,width:(r.x1-r.x0)*unit,height:(r.y1-r.y0)*unit})),graphics:mergeRects(components.map(r=>expand(r,2,page)),3),rules:mergeRects(rules,1),bullets,tableGrids:detectTableGrids(gridInk,gw,gh,gridUnit)};
}

function mergeRects(rects,gap=3){
  const out=[];
  for(const source of rects){let r={...source},again=true;while(again){again=false;for(let i=0;i<out.length;i++){const other=out[i];if(overlap(expand(r,gap,{width:1e6,height:1e6}),other)>0){r=bounds([r,other]);out.splice(i,1);again=true;break}}}out.push(r)}return out;
}

export function isFormula(row){
  const text=row.text.trim(),words=text.match(/[A-Za-z]{3,}/g)||[];
  if(row.mathFont&&words.length<2)return true;
  const symbols=(text.match(/[=<>∑∫√≈≤≥∂∇∞∏∈∝]/gu)||[]).length;
  return (symbols>0&&words.length<=2&&text.length<220&&!/[.!?]\s*$/.test(text))||(/^\(?\d+\)?$/.test(text)&&row.equationNumber===true);
}

const figureCaption=text=>/^Fig(?:ure)?\.?\s*\d+(?:[.\s:]|$)/i.test(text)&&!/^Fig(?:ure)?\.?\s*\d+\s+(?:shows?|illustrates?|depicts?|presents?|is|provides?)\b/i.test(text);

// Text geometry can reveal a gutter even when bullets or horizontal rules bridge it.
export function refineTextColumns(rows,analysis,page){
  const regions=[],result=[];
  function visit(region,lines,depth=0){
    const usable=lines.filter(r=>r.width<region.width*.76&&r.width>15);
    if(depth<3&&usable.length>=2&&region.width>page.width*.35){
      const start=Math.floor(region.x),end=Math.ceil(region.x+region.width),coverage=new Uint16Array(end-start+1);
      for(const r of usable)for(let x=Math.max(start,Math.floor(r.x));x<Math.min(end,Math.ceil(r.x+r.width));x++)coverage[x-start]++;
      const gaps=[];let from=-1;
      for(let i=0;i<=coverage.length;i++){
        if(i<coverage.length&&!coverage[i]){if(from<0)from=i}
        else if(from>=0){if(i-from>=12&&from>region.width*.17&&i<region.width*.84)gaps.push([start+from,start+i]);from=-1}
      }
      for(const [a,b]of gaps.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))){
        const cut=(a+b)/2,left=lines.filter(r=>r.x+r.width<=cut),right=lines.filter(r=>r.x>=cut),cross=lines.filter(r=>r.x<cut&&r.x+r.width>cut);
        const minimum=1;
        if(left.length<minimum||right.length<minimum||cross.length>Math.max(1,lines.length*.1))continue;
        // Cross-column headings retain their own full-width zones.
        for(const r of cross){const id=regions.length;regions.push({...r,id});result.push({...r,regionId:id})}
        visit({...region,width:cut-region.x},left,depth+1);
        visit({...region,x:cut,width:region.x+region.width-cut},right,depth+1);return;
      }
    }
    const id=regions.length;regions.push({...region,id});result.push(...lines.map(r=>({...r,regionId:id})));
  }
  for(const region of analysis.regions)visit(region,rows.filter(r=>r.regionId===region.id||(r.regionId==null&&overlap(r,region)>r.width*r.height*.6)));
  // XY cutting may separate generously spaced text into individual lines.
  // Rejoin vertically adjacent lines with the same left margin and font size.
  const joined=[],assigned=[];
  for(const region of regions.sort((a,b)=>a.y-b.y||a.x-b.x)){
    const lines=result.filter(r=>r.regionId===region.id);if(!lines.length){joined.push({...region,id:joined.length});continue}
    const box=bounds(lines),font=median(lines.map(r=>r.height));
    const previous=joined.filter(r=>r.lines?.length&&Math.abs(r.left-box.x)<Math.max(7,font*2.4)&&Math.abs(r.font-font)<font*.22&&box.y>=r.bottom-1&&box.y-r.bottom<font*1.4&&Math.min(r.left+r.textWidth,box.x+box.width)-Math.max(r.left,box.x)>Math.min(box.width,r.textWidth)*.65).sort((a,b)=>b.bottom-a.bottom)[0];
    if(previous){const b=bounds([previous,region]);Object.assign(previous,b,{bottom:box.y+box.height,textWidth:Math.max(previous.textWidth,box.width)});previous.lines.push(...lines)}
    else joined.push({...region,id:joined.length,left:box.x,bottom:box.y+box.height,font,textWidth:box.width,lines:[...lines]});
  }
  for(const region of joined)assigned.push(...(region.lines||[]).map(r=>({...r,regionId:region.id})));
  return {rows:assigned,analysis:{...analysis,regions:joined}};
}

export function buildReadingPage(rows,analysis,page,options={}){
  const tables=options.professional?buildTables(rows,analysis.tableGrids):[];
  ({rows,analysis}=refineTextColumns(rows.filter(r=>!tables.some(t=>overlap(r,t)>r.width*r.height*.5)),analysis,page));
  const textRows=rows.filter(r=>r.text?.trim()).map(r=>({...r,text:r.text.trim(),bullet:r.bullet||(analysis.bullets||[]).some(b=>r.x-b.x-b.width>=1&&r.x-b.x-b.width<12&&Math.abs(b.y+b.height/2-r.y-r.height/2)<r.height*.45)}));
  const protectedRects=analysis.graphics.filter(r=>!tables.some(t=>overlap(r,t)>Math.min(r.width*r.height,t.width*t.height)*.8))
    // Raised glyphs can join two prose lines into a small raster component.
    .filter(r=>!(r.height<45&&r.width<110&&textRows.some(t=>overlap(r,t)>0&&t.width>r.width*2&&(t.text.match(/[A-Za-z]{3,}/g)||[]).length>=5)))
    .map(r=>({...r,kind:'figure'}));
  for(const row of textRows.filter(r=>/^\d+\s+of\s+\d+$/i.test(r.text)&&r.y>page.height*.9))protectedRects.push({...expand(row,1,page),kind:'page-number'});
  // Never collect labels from the adjacent column, even when they are only a
  // few points from the plot border. A genuinely wide figure can span both.
  const lane=r=>{
    const middle=page.width/2;
    if(r.x+r.width<=middle+2)return {left:0,right:middle};
    if(r.x>=middle-2)return {left:middle,right:page.width};
    return {left:0,right:page.width};
  };
  const inLane=(r,l)=>r.x>=l.left-2&&r.x+r.width<=l.right+2;
  for(const rect of protectedRects){
    const column=lane(rect);
    const labels=textRows.filter(r=>inLane(r,column)&&(overlap(r,rect)>r.width*r.height*.2||(r.text.length<35&&r.y+r.height>rect.y&&r.y<rect.y+rect.height&&r.x+r.width>rect.x-22&&r.x<rect.x+rect.width+22)));
    if(labels.length)Object.assign(rect,expand(bounds([rect,...labels]),3,page));
    const logoRegion=analysis.regions.find(r=>r.y<page.height*.16&&r.height<100&&r.width<page.width*.4&&overlap(rect,r)>rect.width*rect.height*.6);
    if(logoRegion)Object.assign(rect,expand(bounds([rect,logoRegion]),2,page));
  }
  // Ruled tables are visual objects: retain cells, symbols, and numeric alignment.
  const tableCaptions=textRows.filter(r=>/^Table\s*\d/i.test(r.text));
  for(const caption of tableCaptions){
    const first=analysis.rules.filter(r=>r.y>=caption.y&&r.y<caption.y+40&&r.x<=caption.x+15&&r.x+r.width>caption.x+50).sort((a,b)=>a.y-b.y)[0];
    if(!first)continue;
    const nextCaption=Math.min(page.height,...tableCaptions.filter(c=>c!==caption&&c.y>caption.y+10&&c.x>=first.x-10&&c.x<first.x+first.width).map(c=>c.y));
    const lines=analysis.rules.filter(r=>r.y>=first.y&&r.y<nextCaption&&Math.abs(r.x-first.x)<8&&Math.abs(r.width-first.width)<18).sort((a,b)=>a.y-b.y);
    if(lines.length>=2){const bottom=lines[lines.length-1].y;const box=expand({x:first.x,y:caption.y,width:first.width,height:bottom-caption.y+2},4,page);if(!tables.some(t=>overlap(t,box)>t.width*t.height*.8))protectedRects.push({...box,kind:'table'})}
  }
  // A publisher banner combines graphics and text; preserve the complete banner.
  for(const region of analysis.regions){
    const inside=protectedRects.filter(r=>overlap(r,region)>r.width*r.height*.5);
    if(region.y<page.height*.2&&region.height<page.height*.16&&inside.length>=2)protectedRects.push({...region,kind:'banner'});
    if((region.y<35||region.y>page.height-35)&&region.height<18)protectedRects.push({...region,kind:'running-header'});
  }
  // A figure is copied as one rectangle, including its axis labels and annotations.
  for(const caption of textRows.filter(r=>figureCaption(r.text))){
    const column=lane(caption);
    const nearby=protectedRects.filter(r=>r.kind==='figure'&&inLane(r,column)&&r.y+r.height<=caption.y+5&&caption.y-r.y-r.height<95&&Math.min(r.x+r.width,caption.x+Math.max(caption.width,100))>Math.max(r.x,caption.x-30));
    if(nearby.length){
      // Multi-panel figures can extend well above their final caption. Walk
      // upwards across panel labels, stopping at prose or another figure caption.
      let added=true;
      while(added){added=false;const groupBox=bounds(nearby);
        for(const candidate of protectedRects){
          if(candidate.kind!=='figure'||nearby.includes(candidate)||!inLane(candidate,column))continue;
          const gap=groupBox.y-candidate.y-candidate.height;
          if(gap<0||gap>100)continue;
          const barrier=textRows.some(t=>inLane(t,column)&&t.y>=candidate.y+candidate.height-1&&t.y+t.height<=groupBox.y+1&&(/^\s*(?:Fig(?:ure)?\.?\s*\d|Table\s*\d)/i.test(t.text)||(t.text.match(/[A-Za-z]{3,}/g)||[]).length>=6));
          if(!barrier){nearby.push(candidate);added=true}
        }
      }
      const r=bounds(nearby),captionLines=[caption];
      const following=textRows.filter(t=>t!==caption&&inLane(t,column)&&t.regionId===caption.regionId&&t.y>caption.y&&t.x>=caption.x-8&&t.x<caption.x+caption.width).sort((a,b)=>a.y-b.y);
      for(const t of following){const previous=captionLines.at(-1);if(t.y-previous.y-previous.height>caption.height*.9||/^(?:Fig(?:ure)?\.?\s*\d|Table\s*\d)/i.test(t.text))break;captionLines.push(t)}
      const labels=textRows.filter(t=>inLane(t,column)&&t.y>=r.y-6&&t.y+t.height<=caption.y-2&&t.x+t.width>r.x-18&&t.x<r.x+r.width+18);
      Object.assign(nearby[0],expand(bounds([r,...labels,...captionLines]),4,page));for(const other of nearby.slice(1))protectedRects.splice(protectedRects.indexOf(other),1)
    }
  }
  for(const row of textRows.filter(isFormula)){
    if(tables.some(t=>overlap(row,t)>row.width*row.height*.5))continue;
    if(protectedRects.some(r=>overlap(row,r)>row.width*row.height*.5))continue;
    const region=analysis.regions.find(r=>r.id===row.regionId);
    const regionRows=textRows.filter(r=>r.regionId===row.regionId);
    const proseWords=regionRows.reduce((n,r)=>n+(r.text.match(/[A-Za-z]{3,}/g)||[]).length,0);
    if(region&&proseWords<9){protectedRects.push({...expand(region,2,page),kind:'formula'});continue}
    const number=textRows.find(other=>other!==row&&Math.abs(other.y-row.y)<row.height&&/^\(?\d+\)?$/.test(other.text.trim())&&other.x>row.x+row.width);
    const box=expand(bounds(number?[row,number]:[row]),2,page);
    if(region){box.y=Math.max(region.y,box.y);box.height=Math.min(region.y+region.height-box.y,box.height+2)}
    const nextProse=Math.min(page.height,...textRows.filter(t=>t.y>=row.y+row.height+2&&!isFormula(t)&&(t.text.match(/[A-Za-z]{3,}/g)||[]).length>=5&&t.x<box.x+box.width&&t.x+t.width>box.x).map(t=>t.y));
    box.height=Math.min(box.height,nextProse-2-box.y);
    protectedRects.push({...box,kind:'formula'});
  }
  // Keep separate crop rectangles: joining a formula with an adjacent figure
  // into their bounding box can silently copy the prose in the empty corners.
  for(const rect of protectedRects.filter(r=>r.kind==='figure')){
    const caption=textRows.find(t=>figureCaption(t.text)&&t.y<rect.y&&t.y+t.height>rect.y&&t.x<rect.x+rect.width&&t.x+t.width>rect.x);
    if(caption){const bottom=rect.y+rect.height;rect.y=caption.y+caption.height+1;rect.height=bottom-rect.y;}
  }
  let preserved=protectedRects.filter((r,i)=>!protectedRects.some((p,j)=>j!==i&&overlap(r,p)>=r.width*r.height-.01&&(p.width*p.height>r.width*r.height+.01||j<i))).map(({x,y,width,height,kind})=>({x,y,width,height,kind}));
  for(const table of tables)preserved=preserved.flatMap(r=>{
    if(!overlap(r,table))return [r];
    const left=Math.max(r.x,table.x),right=Math.min(r.x+r.width,table.x+table.width),top=Math.max(r.y,table.y),bottom=Math.min(r.y+r.height,table.y+table.height);
    return [{...r,height:top-r.y},{...r,y:bottom,height:r.y+r.height-bottom},{...r,y:top,height:bottom-top,width:left-r.x},{...r,x:right,y:top,height:bottom-top,width:r.x+r.width-right}].filter(p=>p.width>0&&p.height>0);
  });
  const exclusions=[...preserved,...tables];
  const prose=textRows.filter(row=>!exclusions.some(r=>overlap(row,r)>row.width*row.height*.22));
  const paragraphs=[],zones=[];
  const flowRegions=[];
  for(const region of analysis.regions){
    let slices=[{...region}];
    for(const r of exclusions){
      if(Math.min(r.x+r.width,region.x+region.width)-Math.max(r.x,region.x)<region.width*(r.kind==='formula'?.08:.35))continue;
      slices=slices.flatMap(s=>{
        if(r.y>=s.y+s.height||r.y+r.height<=s.y)return [s];
        return [{...s,height:r.y-2-s.y},{...s,y:r.y+r.height+2,height:s.y+s.height-r.y-r.height-2}].filter(p=>p.height>2);
      });
    }
    flowRegions.push(...slices);
  }
  for(const region of flowRegions){
    const lines=prose.filter(row=>(row.regionId===region.id||(row.regionId==null&&overlap(row,region)>row.width*row.height*.6))&&row.y+row.height/2>=region.y&&row.y+row.height/2<=region.y+region.height).sort((a,b)=>a.y-b.y||a.x-b.x);
    if(!lines.length)continue;
    const lineHeight=median(lines.map(l=>l.height));
    const starts=lines.map(l=>l.x).sort((a,b)=>a-b),left=starts[Math.floor(starts.length*.15)]??region.x;
    const bodyLeft=median(lines.filter(l=>l.bullet).map(l=>l.x));
    const bulletIndent=lines.some(l=>l.bullet)?bodyLeft:left;
    const right=Math.min(page.width-12,region.x+region.width,Math.max(...lines.map(l=>l.x+l.width)));
    const fullWidth=right-left;
    const typicalGap=median(lines.slice(1).map((r,i)=>r.y-lines[i].y-lines[i].height).filter(n=>n>=0));
    let group=[];
    const finish=()=>{if(!group.length)return;const box=bounds(group),text=group.map((line,i)=>i&&/[a-z]-$/i.test(group[i-1].text)?line.text.replace(/^\s+/,''):line.text).reduce((joined,text)=>/[a-z]-$/i.test(joined)?joined.slice(0,-1)+text:(joined?joined+' ':'')+text,'');
      const id=paragraphs.length;paragraphs.push({id,text,sourceRows:group,x:left,y:box.y,width:fullWidth,height:box.height,fontSize:median(group.map(l=>l.height)),bullet:group[0].bullet,indent:!group[0].bullet&&group[0].x-left>lineHeight*.65,heading:group.length<=2&&(group[0].height>lineHeight*1.18||/^[A-Z][A-Z\s-]{3,}$/.test(text)||/^\d+(?:\.\d+)*\.?\s*[A-Z]/.test(text)),zoneId:zones.length});group=[];return id};
    const ids=[];
    for(const line of lines){const previous=group[group.length-1];
      const paragraphChange=previous&&line.paragraphId&&previous.paragraphId&&line.paragraphId!==previous.paragraphId;
      const indent=previous&&!group[0].bullet&&line.x-bulletIndent>lineHeight*.7&&previous.x+previous.width>left+fullWidth*.6;
      const gap=previous&&line.y-previous.y-previous.height;
      const sizeChange=previous&&Math.max(line.height,previous.height)/Math.max(1,Math.min(line.height,previous.height))>1.3;
      const headingChange=previous&&/^[A-Z][A-Z\s-]{3,}$/.test(previous.text)&&!previous.bullet;
      const shortEnd=previous&&!group[0].bullet&&previous.width<fullWidth*.72&&gap>=Math.max(lineHeight*.3,typicalGap*.8);
      if(previous&&(line.bullet||paragraphChange||indent||gap>Math.max(lineHeight*.8,typicalGap+lineHeight*.6)||sizeChange||shortEnd||headingChange)){const id=finish();if(id!=null)ids.push(id)}
      group.push(line);
    }
    const id=finish();if(id!=null)ids.push(id);
    const box=bounds(lines),blocking=exclusions.filter(r=>r.y>=box.y&&r.x<right&&r.x+r.width>left);
    let bottom=Math.min(page.height-10,Math.max(region.y+region.height,box.y+box.height)+5);
    for(const r of blocking)if(r.y>box.y)bottom=Math.min(bottom,r.y-4);
    zones.push({id:zones.length,x:left,y:box.y,width:fullWidth,height:Math.max(box.height,bottom-box.y),paragraphIds:ids,sourceFont:lineHeight});
  }
  // Do not leave isolated one-line OCR fragments unrepresented.
  for(const table of tables)for(const cell of table.cells.filter(c=>c.translate)){
    const id=paragraphs.length,zoneId=zones.length,padding=Math.min(3,cell.width*.07);
    paragraphs.push({id,zoneId,text:cell.text,sourceRows:cell.sourceRows,x:cell.x+padding,y:cell.y+2,width:cell.width-padding*2,height:cell.height-4,fontSize:cell.fontSize,heading:cell.header,indent:false,tableCell:true});
    zones.push({id:zoneId,x:cell.x+padding,y:cell.y+2,width:cell.width-padding*2,height:Math.max(1,cell.height-4),paragraphIds:[id],sourceFont:cell.fontSize,tableCell:true});
  }
  return {page,paragraphs,zones,preserved,rules:analysis.rules,regions:analysis.regions,tables};
}

export function wrapParagraph(ctx,text,width,font,indent=0){
  const lines=[];let current='',limit=width-indent;
  const tokens=text.match(/[A-Za-z0-9_]+(?:[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]+)?(?:[.'’°µμ+-][A-Za-z0-9_]+)*|\s+|[^\x00-\x7F]|./gu)||[];
  for(let token of tokens){
    if(!current&&/^\s+$/.test(token))continue;
    if(measureInline(ctx,current+token)>limit&&current){
      if(/^[，。；：！？、）】》”’\])},.;:!?]/u.test(token)&&current.length>1){const tail=[...current].pop();lines.push(current.slice(0,-tail.length).trimEnd());current=tail;limit=width}
      else{lines.push(current.trimEnd());current='';limit=width;if(/^\s+$/.test(token))continue}
    }
    if(measureInline(ctx,token)>limit){for(const ch of token){if(current&&measureInline(ctx,current+ch)>limit){lines.push(current);current='';limit=width}current+=ch}}
    else current+=token;
  }
  if(current)lines.push(current.trimEnd());return lines;
}

export function inlineRuns(text){
  return (text.match(/[₀-₉]+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+|[^₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu)||[]).map(value=>{
    const sub=/^[₀-₉]/u.test(value),sup=/^[⁰¹²³⁴⁵⁶⁷⁸⁹]/u.test(value);
    return {text:sub?value.replace(/[₀-₉]/gu,d=>String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d))):sup?value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu,d=>String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(d))):value,script:sub?'sub':sup?'super':null};
  });
}
function measureInline(ctx,text){
  if(!/[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]/u.test(text))return ctx.measureText(text).width;
  const original=ctx.font;let width=0;
  for(const run of inlineRuns(text)){ctx.font=run.script?original.replace(/([\d.]+)px/,(_,n)=>Number(n)*.7+'px'):original;width+=ctx.measureText(run.text).width}
  ctx.font=original;return width;
}
function paintInline(ctx,text,x,y,font){
  const original=ctx.font;
  for(const run of inlineRuns(text)){ctx.font=run.script?original.replace(/([\d.]+)px/,(_,n)=>Number(n)*.7+'px'):original;ctx.fillText(run.text,x,y+(run.script==='sub'?font*.38:run.script==='super'?-font*.15:0));x+=ctx.measureText(run.text).width}
  ctx.font=original;
}

export function typesetPage(ctx,model,translations){
  const placed=[];
  for(const zone of model.zones){
    const paragraphs=zone.paragraphIds.map(id=>model.paragraphs[id]);
    const max=zone.tableCell?Math.min(12,zone.sourceFont):Math.min(18,Math.max(10,zone.sourceFont*1.55)),min=5.5;
    const trial=font=>{
      let y=zone.y;const result=[];
      for(const p of paragraphs){const size=p.heading&&!zone.tableCell?Math.min(20,font*1.12):font;
        ctx.font=`${p.heading?'600 ':''}${size}px "Microsoft YaHei", sans-serif`;
        const text=(p.bullet?'• ':'')+(translations?.[p.id]??p.text),indent=p.indent&&!p.heading?size*2:0;
        const lines=wrapParagraph(ctx,text,zone.width,size,indent),leading=size*1.36;
        result.push({...p,text,lines,fontSize:size,lineHeight:leading,x:zone.x,y,width:zone.width,indent});
        y+=lines.length*leading+font*.55;
      }
      return {height:y-zone.y-font*.55,result};
    };
    let lo=Math.min(min,zone.height/3),hi=max;
    while(trial(lo).height>zone.height&&lo>.15)lo/=2;
    for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(trial(mid).height<=zone.height)lo=mid;else hi=mid}
    // Reserve a small margin for font hinting differences between preview and
    // scaled export, and validate the actual final line set after fitting.
    let fitted=trial(lo*.97);
    for(let i=0;fitted.height>zone.height+.01&&i<30;i++){lo*=.97;fitted=trial(lo*.97)}
    placed.push(...fitted.result);
  }
  return placed;
}

export function paintRebuiltPage(ctx,source,model,placed,scale){
  ctx.save();ctx.fillStyle='#fff';ctx.fillRect(0,0,model.page.width*scale,model.page.height*scale);
  const sx=source.pdfScale||source.width/model.page.width,sy=source.pdfScale||source.height/model.page.height;
  for(const rect of model.preserved)ctx.drawImage(source,rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy,rect.x*scale,rect.y*scale,rect.width*scale,rect.height*scale);
  paintTables(ctx,source,model.tables,scale);
  ctx.strokeStyle='#aeb4b1';ctx.lineWidth=.45*scale;
  for(const r of model.rules){if([...model.preserved,...(model.tables||[])].some(p=>overlap(r,p)>r.width*r.height*.5))continue;ctx.beginPath();ctx.moveTo(r.x*scale,r.y*scale);ctx.lineTo((r.x+r.width)*scale,r.y*scale);ctx.stroke()}
  ctx.fillStyle='#111';ctx.textBaseline='top';
  for(const p of placed){ctx.font=`${p.heading?'600 ':''}${p.fontSize*scale}px "Microsoft YaHei", sans-serif`;
    p.lines.forEach((line,i)=>paintInline(ctx,line,(p.x+(i?0:p.indent))*scale,(p.y+i*p.lineHeight)*scale,p.fontSize*scale));}
  ctx.restore();
}
