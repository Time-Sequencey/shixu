import assert from 'node:assert/strict';
import {detectTableGrids,buildTables,tableTextNeedsTranslation,protectInlineText} from '../app/tables.mjs';
import {buildReadingPage,extractNativeRows} from '../app/页面重建.mjs';

// A grey header must contribute both borders, with separate header cells even
// when binarization hides the dividers inside the fill.
const w=330,h=170,ink=new Uint8Array(w*h);
for(let y=20;y<=100;y++)for(let x=10;x<=310;x++){
  if(y<=40||[40,60,80,100].includes(y)||[10,100,200,310].includes(x))ink[y*w+x]=1;
}
const grids=detectTableGrids(ink,w,h,1);
assert.equal(grids.length,1);
assert.ok(grids[0].ys[0]<23);
const row=(text,x,y,width=60)=>({text,x,y,width,height:8,regionId:0});
const rows=[row('Parameter',15,25),row('Symbol',110,25),row('Units',210,25),
  row('Input voltage',15,45),row('VIN',110,45),row('V',210,45),
  row('Output current',15,65),row('IOUT',110,65),row('A',210,65)];
const tables=buildTables(rows,grids);
assert.equal(tables.length,1);
assert.deepEqual(tables[0].cells.filter(c=>c.header).map(c=>c.text),['Parameter','Symbol','Units']);
assert.equal(tables[0].cells.find(c=>c.text==='VIN').translate,false);
assert.equal(tables[0].cells.find(c=>c.text==='Input voltage').translate,true);
// A company banner above a table cannot become its first merged cell.
const withBanner=new Uint8Array(w*(h+50));withBanner.set(ink,50*w);
for(let x=10;x<=310;x++)withBanner[x+2*w]=1;
assert.ok(detectTableGrids(withBanner,w,h+50,1).every(g=>g.y>50));
assert.equal(tableTextNeedsTranslation('UMW PT4115'),false);

// Package dimension identifiers in a header are copied rather than translated.
const dimensionGrid={x:10,y:20,width:300,height:60,xs:[10,100,200,310],ys:[20,40,60,80],
  horizontal:[20,40,60,80].map(y=>({x:10,y,width:300,height:1})),
  vertical:[10,100,200,310].map(x=>({x,y:20,width:1,height:60}))};
const dimensions=buildTables([row('Symbol',15,25),row('A',110,25),row('L3',210,25),row('Min',15,45),row('1.450',110,45),row('4.350',210,45)], [dimensionGrid]);
assert.equal(dimensions[0].cells.find(c=>c.text==='A').translate,false);
assert.equal(dimensions[0].cells.find(c=>c.text==='L3').translate,false);
assert.equal(dimensions[0].cells.find(c=>c.text==='Min').translate,true);
// The first data row can span every column; the visible dividers begin below.
const delayed={...dimensionGrid,vertical:dimensionGrid.vertical.map(r=>r.x===10||r.x===310?r:{...r,y:60,height:20})};
const delayedRows=[row('Parameter',15,25),row('Symbol',110,25),row('Units',210,25),row('Power switch',15,45),row('Resistance',15,65),row('RON',110,65),row('Ohm',210,65)];
assert.equal(buildTables(delayedRows,[delayed])[0].cells.filter(c=>c.header).length,3);

// A small subscript can share a PDF item with a comparison and its value.
const native=extractNativeRows({items:[
  {str:'When the voltage V',transform:[10,0,0,10,20,50],width:85},
  {str:'CSN)> 115mV,',transform:[5.83,0,0,5.83,105,51.33],width:50},
],styles:{}},{transform:[1,0,0,1,0,0]},[{id:0,x:0,y:0,width:300,height:100}],(_,b)=>b);
assert.equal(native.length,1);
assert.equal(native[0].text,'When the voltage VCSN)> 115mV,');
const thermal=extractNativeRows({items:[
  {str:', θ',transform:[9,0,0,9,90,40],width:10},
  {str:'temperature T',transform:[9,0,0,9,20,40.018],width:70},
  {str:'JA, and ambient temperature',transform:[5.247,0,0,5.247,100,41],width:100},
],styles:{}},{transform:[1,0,0,1,0,0]},[{id:0,x:0,y:0,width:300,height:100}],(_,b)=>b);
assert.equal(thermal.length,1);
assert.equal(thermal[0].text,'temperature T, θJA, and ambient temperature');

// Fraction bars are sometimes vector paths, with no equals sign in extracted
// text. Keep numerator, denominator and identifier together as an image.
const math=[row('0.1 x D',110,100,45),row('IOUT',85,108,20),row('Rs',120,118,12)];
const prose=row('When the voltage is below 2.5V, the current is reduced.',20,155,280);
prose.regionId=1;
const model=buildReadingPage([...math,prose],{
  regions:[{id:0,x:80,y:97,width:100,height:35},{id:1,x:18,y:152,width:285,height:20}],
  graphics:[],rules:[],tableGrids:[],
},{width:330,height:400});
assert.ok(model.preserved.some(r=>r.kind==='formula'&&r.y<100&&r.y+r.height>125));
assert.deepEqual(model.paragraphs.map(p=>p.text),[prose.text]);
// A numbered note has a hanging continuation; translating it separately can
// detach "temperature" from "conversions" and change the technical meaning.
const noteRows=[row('Note 1: The bus is held during temperature',20,60,280),
  row('conversions and EEPROM writes.',65,70,230),
  row('Note 2: The master can issue a reset.',20,80,260)];
noteRows[0].parts=[{text:'Note 1:',x:20},{text:'The bus is held during temperature',x:65}];
const notes=buildReadingPage(noteRows,{regions:[{id:0,x:18,y:58,width:290,height:40}],graphics:[],rules:[],tableGrids:[]},{width:330,height:400});
assert.deepEqual(notes.paragraphs.map(p=>p.text),['Note 1: The bus is held during temperature conversions and EEPROM writes.',noteRows[2].text]);
console.log('通过：灰底表头、跨栏单元格、尺寸代号、行内字母下标和分式完整保留。');

// Report regressions: PDF symbol bullets and raised scientific notation must
// remain attached even when the PDF draws the small character first.
const fragments=(items)=>extractNativeRows({items:items.map(([str,x,y,size,width])=>({str,transform:[size,0,0,size,x,y],width})),styles:{}},{transform:[1,0,0,1,0,0]},[{id:0,x:0,y:0,width:400,height:300}],(_,b)=>b);
assert.equal(fragments([['\u0083 Surface Mount',20,40,10,100]])[0].bullet,true);
assert.equal(fragments([['2',110,47,7,4],['I',100,50,10,10],['C interface',114,50,10,60]])[0].text,'I²C interface');
assert.equal(fragments([['[23]',100,47,7,12],['Jensen et al.',20,50,10,80]])[0].text,'Jensen et al.[23]');
assert.equal(fragments([['−1',100,47,7,8],['cm',80,50,10,20]])[0].text,'cm⁻¹');
assert.equal(fragments([['−',100,47,7,5],['1',105,47,7,3],['cm',80,50,10,20]])[0].text,'cm⁻¹');
const protectedExponent=protectInlineText('at 39.9 cd A⁻¹ and cm⁻²');
assert.ok(!protectedExponent.text.includes('⁻'));
assert.equal(protectedExponent.restore(protectedExponent.text),'at 39.9 cd A⁻¹ and cm⁻²');
assert.throws(()=>protectedExponent.restore('lost exponent'));
// A partial graphic crop must preserve the full intersecting line, without
// enlarging the figure across the adjacent column.
const crossing=row('Complete running header across the page',20,20,280);
const cropModel=buildReadingPage([crossing],{regions:[{id:0,x:10,y:10,width:300,height:50}],graphics:[{x:150,y:20,width:90,height:20}],rules:[],tableGrids:[]},{width:330,height:400});
assert.ok(cropModel.paragraphs.some(p=>p.text===crossing.text)||cropModel.preserved.some(r=>r.x<=crossing.x&&r.x+r.width>=crossing.x+crossing.width));
console.log('通过：符号项目符号、I²C、引用标记、负指数与裁切行完整性。');
