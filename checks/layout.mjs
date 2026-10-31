import assert from 'node:assert/strict';
import { buildReadingPage, isFormula, typesetPage } from '../app/页面重建.mjs';
import { buildTables, protectTableText, tableTextNeedsTranslation } from '../app/tables.mjs';
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
console.log('通过：模式隔离、OCR 单元格定位、参数防改动、字号适配、公式识别。');
