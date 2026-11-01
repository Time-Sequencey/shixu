import assert from 'node:assert/strict';
import { buildReadingPage, isFormula, typesetPage, extractNativeRows, analyzeRaster, inlineRuns, wrapParagraph } from '../app/页面重建.mjs';
import { buildTables, protectTableText, tableTextNeedsTranslation, protectInlineText, tableHeaderTranslations } from '../app/tables.mjs';
const grid = { x: 20, y: 100, width: 300, height: 60, xs: [20, 200, 320], ys: [100, 120, 140, 160],
  horizontal: [100, 120, 140, 160].map(y => ({ x: 20, y, width: 300, height: 1 })),
  vertical: [20, 200, 320].map(x => ({ x, y: 100, width: 1, height: 60 })) };
const words = [['Parameter', 25, 104], ['Value', 205, 104], ['Supply voltage', 25, 124], ['12V', 205, 124], ['Output current', 25, 144], ['1A', 205, 144]]
  .map(([text, x, y]) => ({ text, x, y, width: 85, height: 9 }));
const rows = [{ text: 'OCR merged rows', words, x: 20, y: 100, width: 300, height: 60, regionId: 0 }];
const tables = buildTables(rows, [grid]);
assert.equal(tables[0].cells.length, 6);
for (const text of ['12V', '1A', 'VIN', 'fDIM', '5000:1', 'VDIM < 0.3V']) assert.equal(tableTextNeedsTranslation(text), false);
const safe = protectTableText('CSN and VIN: 12V, PWM at 20kHz');
assert.equal(safe.restore(safe.text), 'CSN and VIN: 12V, PWM at 20kHz');
assert.throws(() => safe.restore('missing marker'));
assert.throws(() => safe.restore(safe.text + ' 99'));
assert.equal(protectTableText('DIGITAL OUTPUT RESOLUTION TIME').text,'DIGITAL OUTPUT RESOLUTION TIME');
for(const text of ['FFF8h','(tCONV/8)'])assert.equal(tableTextNeedsTranslation(text),false);
const packageText=protectTableText('3 TO-92 (2000 Piece), DS18B20, 1-Wire');
assert.ok(!packageText.text.includes('TO-92'));assert.ok(!packageText.text.includes('DS18B20'));assert.ok(!packageText.text.includes('1-Wire'));
assert.equal(packageText.restore(packageText.text),'3 TO-92 (2000 件), DS18B20, 1-Wire');
const analysis = { regions: [{ id: 0, x: 20, y: 100, width: 300, height: 60 }], graphics: [grid], rules: [], tableGrids: [grid] };
assert.equal(buildReadingPage(rows, analysis, { width: 600, height: 800 }).tables.length, 0);
const model = buildReadingPage(rows, analysis, { width: 600, height: 800 }, { professional: true });
assert.equal(model.paragraphs.filter(p => p.tableCell).length, 4);
const context = { font: '10px sans-serif', measureText(text) { const size = Number(this.font.match(/([\d.]+)px/)[1]); return { width: [...text].length * size }; } };
for (const p of typesetPage(context, model, model.paragraphs.map(() => '中文测试译文'))) {
  const zone = model.zones[p.zoneId];
  assert.ok(p.y + p.lines.length * p.lineHeight <= zone.y + zone.height + .01);
}
assert.ok(isFormula({ text: 'I = 0.1 / Rs' }));
for(const text of ['±0.5°C Accuracy from -10°C to +85°C','T&R = Tape and reel.'])assert.equal(isFormula({text}),false);
const inline=protectInlineText('N₀ and N₁, log₁₀');
assert.equal(inline.restore(inline.text),'N₀ and N₁, log₁₀');
assert.throws(()=>inline.restore('N0 and N1'));
assert.deepEqual(inlineRuns('N₀'),[{text:'N',script:null},{text:'0',script:'sub'}]);
assert.equal(tableHeaderTranslations.get('PART'),'型号');
assert.equal(tableTextNeedsTranslation('N.C.'),false);
// Deliberately scramble PDF drawing order: the subscript was drawn last.
const native=extractNativeRows({items:[
  {str:'Result N',transform:[12,0,0,12,20,30],width:44},
  {str:'. Next sentence',transform:[12,0,0,12,68,30],width:75},
  {str:'0',transform:[8,0,0,8,64,30.48],width:4},
],styles:{}},{transform:[1,0,0,1,0,0]},[{id:0,x:0,y:0,width:200,height:100}],(a,b)=>b);
assert.equal(native.length,1);assert.match(native[0].text,/N₀/);assert.doesNotMatch(native[0].text,/N\s+0/);
const ordinal=extractNativeRows({items:[
  {str:'the 9',transform:[12,0,0,12,20,30],width:28},
  {str:'th',transform:[8,0,0,8,48,24.5],width:8},
  {str:'byte',transform:[12,0,0,12,56,30],width:24},
],styles:{}},{transform:[1,0,0,1,0,0]},[{id:0,x:0,y:0,width:200,height:100}],(a,b)=>b);
assert.equal(ordinal.length,1);assert.match(ordinal[0].text,/9th/);
const proseRow={text:'The memory copies the scratchpad data after a command.',x:20,y:100,width:400,height:12,regionId:0};
const proseModel=buildReadingPage([proseRow],{regions:[{id:0,x:20,y:100,width:400,height:30}],graphics:[{x:150,y:100,width:50,height:25}],rules:[],bullets:[]},{width:600,height:800});
assert.equal(proseModel.preserved.length,0);assert.equal(proseModel.paragraphs[0].text,proseRow.text);
// A connected flowchart spanning over 70% of a page must remain an image.
const raster={width:300,height:400,data:new Uint8ClampedArray(300*400*4).fill(255)};
for(let y=45;y<=370;y++)for(let x=20;x<=280;x++)if(x===20||x===280||y===45||y===370){const i=(y*300+x)*4;raster.data[i]=raster.data[i+1]=raster.data[i+2]=0}
const detected=analyzeRaster(raster,{width:300,height:400});
assert.ok(detected.graphics.some(r=>r.height>300));
const diagram=buildReadingPage([{text:'MASTER RESET',x:80,y:100,width:80,height:10,regionId:detected.regions.find(r=>r.y<100&&r.y+r.height>100)?.id}],detected,{width:300,height:400});
assert.equal(diagram.paragraphs.length,0);assert.ok(diagram.preserved.some(r=>r.height>300));
const tokenLines=wrapParagraph(context,'结果 N₀ 和 N₁',70,10);
assert.ok(tokenLines.some(line=>line.includes('N₀')));assert.ok(tokenLines.some(line=>line.includes('N₁')));
console.log('通过：模式隔离、OCR 单元格定位、参数防改动、字号适配、公式识别。');
