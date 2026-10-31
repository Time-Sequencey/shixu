const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
async function create() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Electronics datasheet translation demo');
  pdf.setSubject('Synthetic example; all specifications are demonstration data.');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const text = (value, x, y, size = 11, strong = false) => page.drawText(value, { x, y, size, font: strong ? bold : font });
  text('DATASHEET TRANSLATION DEMO', 42, 785, 20, true);
  text('Synthetic example for layout testing. These are not real device ratings.', 42, 758, 10);
  text('Electrical Characteristics', 42, 710, 16, true);
  const columns = [42, 247, 324, 395, 467, 553], top = 680, height = 32;
  const rows = [
    ['Parameter', 'Symbol', 'Min', 'Max', 'Units'],
    ['Supply voltage', 'VIN', '6', '30', 'V'],
    ['Output current', 'IOUT', '0.1', '1.2', 'A'],
    ['Switching frequency', 'FSW', '100', '500', 'kHz'],
    ['Operating temperature', 'TA', '-20', '85', 'C'],
  ];
  page.drawRectangle({ x: 42, y: top - height, width: 511, height, color: rgb(.93, .94, .94) });
  for (let r = 0; r <= rows.length; r++) page.drawLine({ start: { x: 42, y: top - r * height }, end: { x: 553, y: top - r * height }, thickness: .7 });
  for (const x of columns) page.drawLine({ start: { x, y: top }, end: { x, y: top - rows.length * height }, thickness: .7 });
  rows.forEach((row, r) => row.forEach((value, c) => text(value, columns[c] + 6, top - r * height - 21, 11, r === 0)));
  text('Read the source values alongside the translation.', 42, 480, 12);
  text('Enable electronics mode to translate table headers and parameter descriptions.', 42, 454, 11);
  text('Numbers, symbols, and units should remain unchanged.', 42, 430, 11);
  const next = pdf.addPage([595.28, 841.89]);
  next.drawText('Reading and export', { x: 42, y: 785, size: 20, font: bold });
  next.drawText('You can navigate between pages while a document is being translated.', { x: 42, y: 740, size: 11, font });
  next.drawText('After translating every page, export Chinese or side-by-side bilingual PDF.', { x: 42, y: 714, size: 11, font });
  fs.writeFileSync(path.join(__dirname, '../assets/example.pdf'), await pdf.save());
}
create().catch(error => { console.error(error.message); process.exitCode = 1; });
