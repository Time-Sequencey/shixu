const fs = require('node:fs');
const path = require('node:path');
const copyTree = require('./copy-tree.cjs');
const root = path.resolve(__dirname, '..');
function packageDirectory(name) {
  return path.dirname(require.resolve(name + '/package.json', { paths: [root] }));
}
const vendor = path.join(root, 'app/文档助手依赖');
fs.mkdirSync(vendor, { recursive: true });
const pdfjs = packageDirectory('pdfjs-dist');
fs.copyFileSync(path.join(pdfjs, 'build/pdf.min.mjs'), path.join(vendor, 'pdf.mjs'));
fs.copyFileSync(path.join(pdfjs, 'build/pdf.worker.min.mjs'), path.join(vendor, 'pdf.worker.mjs'));
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  copyTree(path.join(pdfjs, folder), path.join(vendor, 'pdf-assets', folder));
}
fs.copyFileSync(path.join(packageDirectory('pdf-lib'), 'dist/pdf-lib.min.js'), path.join(vendor, 'pdf-lib.min.js'));
fs.copyFileSync(path.join(root, 'assets/eng.traineddata'), path.join(vendor, 'eng.traineddata'));
fs.copyFileSync(path.join(pdfjs, 'LICENSE'), path.join(vendor, 'PDFjs-LICENSE.txt'));
fs.copyFileSync(path.join(packageDirectory('pdf-lib'), 'LICENSE.md'), path.join(vendor, 'pdf-lib-LICENSE.md'));
require('./create-example.cjs');
console.log('本地 PDF/OCR 资源已准备好。运行 npm start 启动。');
