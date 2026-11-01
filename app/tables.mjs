// Geometry is in PDF points. Cells are composed on a new page, not painted over
// the original PDF. Untranslated numeric cells are copied as original crops.
const area=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const unique=(values,tolerance=2)=>{const out=[];for(const n of [...values].sort((a,b)=>a-b)){if(!out.length||n-out.at(-1)>tolerance)out.push(n);else out[out.length-1]=(out.at(-1)+n)/2}return out};
function thinRules(lines,horizontal){const out=[];for(const line of lines){const match=out.find(r=>Math.abs((horizontal?r.y:r.x)-(horizontal?line.y:line.x))<2&&Math.abs((horizontal?r.x:r.y)-(horizontal?line.x:line.y))<3&&Math.abs((horizontal?r.width:r.height)-(horizontal?line.width:line.height))<4);if(!match)out.push(line)}return out}
export function detectTableGrids(ink,w,h,unit){
  // A grey header is a filled band in the binary image. Keep its outline,
  // rather than treating every interior scanline as another table boundary.
  const outline=ink.slice(),radius=Math.max(2,Math.ceil(1.5/unit));
  for(let y=radius;y<h-radius;y++)for(let x=radius;x<w-radius;x++){
    const i=y*w+x,d=radius*w;
    if(ink[i]&&ink[i-radius]&&ink[i+radius]&&ink[i-d]&&ink[i+d]&&ink[i-d-radius]&&ink[i-d+radius]&&ink[i+d-radius]&&ink[i+d+radius])outline[i]=0;
  }
  ink=outline;
  const horizontal=[],vertical=[];
  for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){
    if(x<w&&ink[y*w+x]){if(start<0)start=x}
    else if(start>=0){if(x-start>=12/unit)horizontal.push({x:start*unit,y:y*unit,width:(x-start)*unit,height:unit});start=-1}
  }}
  for(let x=0;x<w;x++){let start=-1;for(let y=0;y<=h;y++){
    if(y<h&&(ink[y*w+x]||(y+1<h&&ink[(y+1)*w+x]))){if(start<0)start=y}
    else if(start>=0){if(y-start>=13/unit)vertical.push({x:x*unit,y:start*unit,width:unit,height:(y-start)*unit});start=-1}
  }}
  const groups=[];
  for(const line of horizontal.filter(r=>r.width>=65)){let group=groups.find(g=>Math.abs(g[0].x-line.x)<2&&Math.abs(g[0].width-line.width)<3);if(!group){group=[];groups.push(group)}group.push(line)}
  const tables=[];
  for(const group of groups){
    const ys=unique(group.map(r=>r.y));if(ys.length<3)continue;
    const mid=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const x=mid(group.map(r=>r.x)),right=mid(group.map(r=>r.x+r.width));
    // A long gap usually separates two different tables.
    let chunks=[[]];for(const y of ys){
      const previous=chunks.at(-1).at(-1);
      const connected=previous!==undefined&&vertical.some(r=>Math.abs(r.x-x)<3&&r.y<=previous+2&&r.y+r.height>=y-2);
      if(previous!==undefined&&y-previous>40&&!connected)chunks.push([]);
      chunks.at(-1).push(y);
    }
    for(const edges of chunks){if(edges.length<3)continue;const top=edges[0],bottom=edges.at(-1);
      const lines=thinRules(vertical.filter(r=>r.x>=x-3&&r.x<=right+3&&Math.min(r.y+r.height,bottom)-Math.max(r.y,top)>16),false);
      const xs=unique([x,...lines.filter(r=>r.x>x+8&&r.x<right-8).map(r=>r.x),right],3);
      // Repeated horizontal rules identify a table; an unruled plot with just
      // two axes is deliberately excluded.
      const local=thinRules(horizontal.filter(r=>r.width>=25&&r.y>=top-1&&r.y<=bottom+1&&r.x>=x-3&&r.x+r.width<=right+3&&xs.some(v=>Math.abs(v-r.x)<3)&&xs.some(v=>Math.abs(v-r.x-r.width)<3)),true);
      tables.push({x,y:top,width:right-x,height:bottom-top,ys:unique([...edges,...local.map(r=>r.y)]),xs,vertical:lines,horizontal:local});
    }
  }
  return tables.filter((t,i)=>!tables.some((p,j)=>j!==i&&area(t,p)>t.width*t.height*.98&&p.width*p.height>t.width*t.height+1));
}

export function tableTextNeedsTranslation(text){
  if(!text.trim())return false;
  if(/^[A-Z]{2,8}\s+[A-Z]{1,6}-?\d+[A-Za-z0-9+_-]*$/.test(text.trim()))return false;
  if(/^N\.?\s*C\.?$/i.test(text.trim()))return false;
  if(/^(?:\(?tCONV(?:\/\d+)?\)?|[0-9A-F]{2,}[hH])$/.test(text.trim()))return false;
  if(/^(?:parameter|symbol|conditions?|test conditions?|min(?:imum)?|typ(?:ical)?|max(?:imum)?|units?|value|description|function|name|part|temp range|pin-package|top mark|current|voltage|frequency|resistance|temperature|power|supply|input|output|pin(?: name| no\.?| number)?)$/i.test(text.trim()))return true;
  if(/^[A-Z][A-Z0-9_]*(?:[,-]\s*[A-Z0-9_]+)*$/.test(text.trim())||/^[a-z][A-Z][A-Z0-9_]*$/.test(text.trim()))return false;
  if(/[0-9]/.test(text)&&!/[A-Za-z]{3,}/.test(text.replace(/\bto\b/g,'')))return false;
  if(/[=<>≤≥−]/.test(text)&&(text.match(/[a-z]{3,}/g)||[]).length<2)return false;
  const words=text.match(/[A-Za-z]+/g)||[];
  const fixed=/^(?:VIN|VOUT|VCC|VDD|VSS|GND|AGND|PGND|DIM|CSN?|SW|EN|FB|NC|LED|PWM|SOT\d*|SOP\d*|DFN\d*|QFN\d*|V|mV|A|mA|uA|µA|μA|W|mW|Hz|kHz|MHz|Ohm|kOhm|K|F|pF|nF|uF|µF|H|uH|µH|mm|cm|ms|ns|us|s|C|TA|TJ|Tj|TypCode)$/;
  return words.some(word=>!fixed.test(word)&&!/^\d/.test(word))&&!/^\s*[A-Z]{1,5}[_\d][A-Z\d_-]*\s*$/.test(text);
}

export function protectTableText(text){
  const values=[];
  // Ordering tables use Piece for package quantity, never for pin count.
  text=text.replace(/\bPieces?\b/gi,'件');
  const masked=text.replace(/\b1-Wire\b|(?:[µμu]?SOP|SOT|SOIC|TSSOP|MSOP|SSOP|SO|TO|QFN|DFN|DIP|LQFP|TQFP)(?:-?\d+)?\b|\b[A-Z]{1,6}-?\d+[A-Za-z0-9+_-]*\b|\b(?:VIN|VOUT|VCC|VDD|VSS|AGND|PGND|GND|CSN?|DIM|SW|EN|FB|NC|LED|PWM|MOSFET|PCB|PAD|VGS|VDS|VGSOTH|TCONV|[a-z][A-Z][A-Z0-9_]*)\b|(?:[-+−±]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*(?:mV|µA|μA|uA|mA|kHz|MHz|Hz|mW|[VAFWH]|[pnuµμ]?[FH]|[kKM]?Ω|°C|mm|cm|ns|ms|us|µs|%))|[-+−±]?\d+(?:\.\d+)?/g,value=>{if(/^(?:PARAMETER|SYMBOL|CONDITIONS?|TEST|MIN|MAX|TYP|TYPICAL|MINIMUM|MAXIMUM|UNITS?|VALUE|DESCRIPTION|FUNCTION|PIN|NAME|NUMBER|NO|INPUT|OUTPUT|VOLTAGE|CURRENT|FREQUENCY|RESISTANCE|TEMPERATURE|THERMAL|RATING|RATINGS|DRIVER|DRAIN|INTERNAL|TERMINAL)$/.test(value))return value;const id=values.push(value)-1;return `[KEEP_${id}]`});
  return {text:masked,restore(translated){
    for(let i=0;i<values.length;i++)if(translated.split(`[KEEP_${i}]`).length!==2)throw Error('表格译文未保留参数标记，请重试该页');
    if(/\d/.test(translated.replace(/\[KEEP_\d+\]/g,'')))throw Error('表格译文新增了数值，请重试该页');
    const restored=translated.replace(/\[KEEP_(\d+)\]/g,(_,i)=>{if(Number(i)>=values.length)throw Error('表格译文参数标记错误');return values[Number(i)]});
    return restored;
  }};
}

export const tableHeaderTranslations=new Map(Object.entries({
  'PART':'型号','TEMP RANGE':'温度范围','PIN-PACKAGE':'引脚与封装','TOP MARK':'顶部标记',
  'PIN':'引脚','NAME':'名称','FUNCTION':'功能','PARAMETER':'参数','SYMBOL':'符号','COMMAND':'命令','PROTOCOL':'协议','NOTES':'备注',
  'MIN':'最小值','TYP':'典型值','MAX':'最大值','UNIT':'单位','UNITS':'单位',
  'VALUE':'数值','TEST CONDITIONS':'测试条件','PIN NAME':'引脚名称',
  'ORDER CODE':'订购型号','PACKAGE':'封装','BASE QTY':'基本数量','DELIVERY MODE':'交付方式',
  'OUTPUT CURRENT':'输出电流','INDUCTANCE VALUE':'电感值','SATURATION CURRENT':'饱和电流',
  'MASTER MODE':'主机模式','DATA (LSB FIRST)':'数据（最低位先行）','COMMENTS':'说明',
  'RESET':'复位','PRESENCE':'存在脉冲',
  'REVISION DATE':'修订日期','DESCRIPTION':'说明','PAGES CHANGED':'修改页码',
  'RESOLUTION (BITS)':'分辨率（位）','MAX CONVERSION TIME':'最大转换时间',
  'TEMPERATURE (°C)':'温度（°C）','DIGITAL OUTPUT (BINARY)':'数字输出（二进制）','DIGITAL OUTPUT (HEX)':'数字输出（十六进制）',
  'NO CONNECTION':'不连接','GROUND':'地','CONVERT T':'温度转换 T','RECALL E²':'回读 E²',
  'OPTIONAL VDD. VDD MUST BE GROUNDED FOR OPERATION IN PARASITE POWER MODE.':'可选的外部供电端 VDD。采用寄生供电模式时，VDD 必须接地。',
  '1-WIRE BUS ACTIVITYAFTER COMMAND IS ISSUED':'命令发出后的1-Wire总线活动',
  '1-WIRE BUS ACTIVITY AFTER COMMAND IS ISSUED':'命令发出后的1-Wire总线活动'
}));
const extendedHeader=/^(?:temperature\s*\(°?c\)|digital output\s*\((?:binary|hex)\)|resolution\s*\(bits\)|max conversion time|master mode|data\s*\(lsb first\)|comments|revision date|pages changed|order code|package|base qty|delivery mode|output current|inductance value|saturation current)$/i;
export function protectInlineText(text){
  const values=[];const masked=text.replace(/[A-Za-z]+[₀-₉₊₋⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/gu,value=>`[KEEP_${values.push(value)-1}]`);
  return {text:masked,restore(translated){for(let i=0;i<values.length;i++)if(translated.split(`[KEEP_${i}]`).length!==2)throw Error('译文未完整保留上下标，请重试该页');return translated.replace(/\[KEEP_(\d+)\]/g,(_,i)=>{if(!values[Number(i)])throw Error('译文上下标标记错误');return values[Number(i)]})}};
}

export function buildTables(rawRows,grids){
  const fragments=rawRows.flatMap(r=>r.parts?.length?r.parts:r.words?.length?r.words:[r]).filter(r=>r.text?.trim());
  const tables=[];
  for(const grid of grids||[]){
    const inside=fragments.filter(r=>r.y+r.height/2>grid.y&&r.y+r.height/2<grid.y+grid.height&&r.x+r.width/2>grid.x&&r.x+r.width/2<grid.x+grid.width);
    if(!inside.length)continue;
    let xs=grid.xs,virtualColumns=false;
    if(xs.length<3){
      // Borderless columns: recurring left edges plus the first header line.
      const header=inside.filter(r=>r.y<grid.ys[1]);
      const starts=unique(header.map(r=>r.x),8);
      if(starts.length<2)continue;
      xs=[grid.x,...starts.slice(1).map(x=>x-4),grid.x+grid.width];
      virtualColumns=true;
    }
    const cells=[];
    for(let y=0;y<grid.ys.length-1;y++){
      const top=grid.ys[y],bottom=grid.ys[y+1];let start=xs[0];
      for(let x=1;x<xs.length;x++){
        const last=x===xs.length-1;
        const headerItems=y===0?inside.filter(r=>r.y+r.height/2>=top&&r.y+r.height/2<bottom):[];
        const inferredHeader=y===0&&headerItems.some(r=>r.x+r.width<xs[x])&&headerItems.some(r=>r.x>xs[x])&&!headerItems.some(r=>r.x<xs[x]-1&&r.x+r.width>xs[x]+1)&&grid.vertical.some(r=>Math.abs(r.x-xs[x])<3&&r.y<=bottom+40&&r.y+r.height>bottom+12);
        const divider=last||virtualColumns||!grid.vertical.length||inferredHeader||grid.vertical.some(r=>Math.abs(r.x-xs[x])<3&&Math.min(r.y+r.height,bottom)-Math.max(r.y,top)>(bottom-top)*.55);
        if(!divider)continue;
        const cell={x:start,y:top,width:xs[x]-start,height:bottom-top};start=xs[x];
        const above=cells.find(c=>Math.abs(c.x-cell.x)<2&&Math.abs(c.width-cell.width)<2&&Math.abs(c.y+c.height-top)<2);
        const rule=grid.horizontal.some(r=>Math.abs(r.y-top)<2&&Math.min(r.x+r.width,cell.x+cell.width)-Math.max(r.x,cell.x)>cell.width*.55);
        if(above&&!rule){above.height=bottom-above.y;continue}
        cells.push(cell);
      }
    }
    for(const cell of cells){
        const top=cell.y,bottom=cell.y+cell.height;
        const items=inside.filter(r=>r.x+r.width/2>=cell.x&&r.x+r.width/2<cell.x+cell.width&&r.y+r.height/2>=top&&r.y+r.height/2<bottom).sort((a,b)=>a.y-b.y||a.x-b.x);
        const lines=[];
        for(const item of items){let line=lines.find(l=>Math.abs(l.y-item.y)<Math.max(2,item.height*.45));if(!line){line={y:item.y,items:[]};lines.push(line)}line.items.push(item)}
        const text=lines.map(l=>l.items.sort((a,b)=>a.x-b.x).map(r=>r.text.trim()).join(' ')).join(' ').trim();
        const font=items.length?items.reduce((s,r)=>s+r.height,0)/items.length:9;
        Object.assign(cell,{text,sourceRows:items,fontSize:font,translate:tableTextNeedsTranslation(text),header:false});
    }
    // Require a genuine table header, so graph gridlines remain figures.
    const headers=cells.filter(c=>extendedHeader.test(c.text)||/^(?:parameter|symbol|conditions?|test conditions?|min(?:imum)?|typ(?:ical)?|max(?:imum)?|units?|value|description|function|name|part|temp range|pin-package|top mark|command|protocol|notes|pin(?: name| no\.?| number)?)$/i.test(c.text));
    if(headers.length<2)continue;
    const top=Math.min(...headers.map(c=>c.y)),bottom=Math.max(...cells.filter(c=>c.text&&c.y>=top).map(c=>c.y+c.height));
    const kept=cells.filter(c=>c.y>=top&&c.y<bottom);for(const c of kept){c.header=Math.abs(c.y-top)<2;if(c.header)c.translate||=tableHeaderTranslations.has(c.text.trim().replace(/\s+/g,' ').toUpperCase())}
    const fixedColumns=headers.filter(c=>Math.abs(c.y-top)<2&&/^(?:symbol|units?|master mode|pin (?:no\.?|number))$/i.test(c.text));
    for(const cell of kept)if(!cell.header&&!/^(?:min|max)$/i.test(cell.text.trim())&&fixedColumns.some(h=>cell.x>=h.x-2&&cell.x+cell.width<=h.x+h.width+2))cell.translate=false;
    // An unruled sub-row can mix several conditions with a shared limit. Keep
    // that complete row in place rather than flatten its conditional semantics.
    const conditional=kept.filter(c=>!c.header&&c.sourceRows.filter(r=>/\bpower\b/i.test(r.text)).length>1);
    for(const cell of conditional)for(const other of kept)if(other.y<cell.y+cell.height&&other.y+other.height>cell.y)other.translate=false;
    tables.push({...grid,y:top,height:bottom-top,ys:grid.ys.filter(y=>y>=top-1&&y<=bottom+1),horizontal:grid.horizontal.filter(r=>r.y>=top-1&&r.y<=bottom+1),vertical:grid.vertical.map(r=>({...r,y:Math.max(r.y,top),height:Math.min(r.y+r.height,bottom)-Math.max(r.y,top)})).filter(r=>r.height>0),cells:kept});
  }
  return tables;
}

export function paintTables(ctx,source,tables,scale){
  const factor=source.pdfScale||1;
  for(const table of tables||[]){
    for(const cell of table.cells){
      // Sampling the cell margin keeps grey header fills without the old glyphs.
      const sample=source.getContext('2d').getImageData(Math.min(source.width-1,Math.floor((cell.x+3)*factor)),Math.min(source.height-1,Math.floor((cell.y+3)*factor)),1,1).data;
      const bg=sample[0]+sample[1]+sample[2]>390?sample:[255,255,255];
      ctx.fillStyle=`rgb(${bg[0]},${bg[1]},${bg[2]})`;ctx.fillRect(cell.x*scale,cell.y*scale,cell.width*scale,cell.height*scale);
      if(!cell.translate)ctx.drawImage(source,(cell.x+1)*factor,(cell.y+1)*factor,Math.max(1,cell.width-2)*factor,Math.max(1,cell.height-2)*factor,(cell.x+1)*scale,(cell.y+1)*scale,Math.max(1,cell.width-2)*scale,Math.max(1,cell.height-2)*scale);
    }
    ctx.strokeStyle='#252525';ctx.lineWidth=.65*scale;
    for(const r of table.horizontal){ctx.beginPath();ctx.moveTo(r.x*scale,r.y*scale);ctx.lineTo((r.x+r.width)*scale,r.y*scale);ctx.stroke()}
    for(const r of table.vertical){ctx.beginPath();ctx.moveTo(r.x*scale,r.y*scale);ctx.lineTo(r.x*scale,(r.y+r.height)*scale);ctx.stroke()}
    ctx.strokeRect(table.x*scale,table.y*scale,table.width*scale,table.height*scale);
  }
}
