const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { check, freePort } = require('../boot.cjs');

(async () => {
  let child;
  try {
    check();
    console.log('通过：Windows、PowerShell 和本地依赖检查');
    const occupied = net.createServer();
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const busyPort = occupied.address().port;
      assert.notEqual(await freePort(busyPort), busyPort, '端口冲突时未切换端口');
    } finally { await new Promise(resolve => occupied.close(resolve)); }
    console.log('通过：端口冲突自动切换');
    const port = await freePort(18876);
    child = spawn(process.execPath, ['--require', path.join(__dirname, '../checks/offline-guard.cjs'), path.join(__dirname, '../app/文档助手服务.js')], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      env: { ...process.env, PORT: String(port), OPEN_BROWSER: '0', NODE_PATH: '', NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stderr.on('data', data => { log += data; });
    child.stdout.on('data', () => {});
    const address = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw new Error('本地服务启动失败：' + log);
      try { if ((await fetch(address, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, '本地服务未就绪');
    for (const url of ['/', '/vendor/pdf.mjs', '/vendor/pdf.worker.mjs', '/vendor/pdf-lib.min.js', '/layout.mjs', '/reader.mjs', '/rebuild.mjs', '/tables.mjs', '/default.pdf',
      '/pdf-assets/cmaps/78-EUC-H.bcmap', '/pdf-assets/standard_fonts/LiberationSans-Regular.ttf',
      '/pdf-assets/wasm/openjpeg.wasm', '/pdf-assets/wasm/jbig2.wasm']) {
      const response = await fetch(address + url);
      assert.equal(response.status, 200, '资源缺失：' + url);
      const bytes = await response.arrayBuffer();
      assert.ok(bytes.byteLength > 100, '资源为空：' + url);
    }
    console.log('通过：网页、PDF 渲染/导出库、阅读主程序、页面重建模块与示例 PDF');
    const { buildReadingPage, isFormula } = await import(require('node:url').pathToFileURL(path.join(__dirname,'../app/页面重建.mjs')).href);
    const lines = [40,330].flatMap(x => [100,114,128].map(y => ({text:'English paragraph text',x,y,width:200,height:10,regionId:0})));
    const model = buildReadingPage(lines,{regions:[{id:0,x:35,y:95,width:525,height:80}],graphics:[],rules:[]},{width:600,height:800});
    assert.ok(model.paragraphs.every(p => p.sourceRows.every(r => r.x<300) || p.sourceRows.every(r => r.x>=300)), '左右栏混入同一段落');
    assert.ok(isFormula({text:'I = 0.1 / Rs'}));
    const beside = ['The adjacent column must be translated.','The next line must also be translated.','Body text beside the plot remains editable.'].map((text,i)=>({text,x:307,y:100+i*14,width:250,height:10,regionId:0}));
    const plot = buildReadingPage([{text:'Fig. 1. Plot caption.',x:70,y:300,width:160,height:10,regionId:0},...beside],{regions:[{id:0,x:35,y:75,width:530,height:250}],graphics:[{x:65,y:80,width:230,height:190}],rules:[]},{width:600,height:800});
    assert.ok(beside.every(row=>plot.paragraphs.some(p=>p.sourceRows.some(r=>r.text===row.text))),'图表错误吞入邻栏正文');
    console.log('通过：双栏段落隔离、公式识别与图表邻栏正文防漏译');
    const {buildTables,protectTableText}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../app/tables.mjs')).href);
    const grid={x:0,y:0,width:200,height:60,xs:[0,100,200],ys:[0,20,40,60],horizontal:[0,20,40,60].map(y=>({x:0,y,width:200,height:1})),vertical:[0,100,200].map(x=>({x,y:0,width:1,height:60}))};
    const words=[['Parameter',5,5],['Value',105,5],['Supply voltage',5,25],['12V',105,25],['Output current',5,45],['1A',105,45]].map(([text,x,y])=>({text,x,y,width:80,height:8}));
    const table=buildTables([{text:'OCR line',words}],[grid]);assert.equal(table[0].cells.length,6);assert.equal(table[0].cells.find(c=>c.text==='12V').translate,false);
    const safe=protectTableText('VIN input 12V');assert.equal(safe.restore(safe.text),'VIN input 12V');assert.throws(()=>safe.restore('missing'));
    console.log('通过：表格单元格识别、数值保留和参数标记校验');
    const state = await (await fetch(address + '/api/deepseek/status')).json();
    assert.equal(state.configured, false, '新服务不应带有任何 API Key');
    assert.equal(state.usage.total_tokens, 0);
    console.log('通过：交付包不带 API Key 或账户用量');
    const response = await fetch(address + '/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'image/png' },
      body: fs.readFileSync(path.join(__dirname, '../checks/ocr-test.png')),
      signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error || 'OCR 请求失败');
    const text = result.rows.map(row => row.text).join(' ');
    assert.match(text, /HELLO\s+WORLD/i, 'OCR 没有正确识别测试图像');
    console.log('通过：禁止网络访问时，本地 OCR 引擎、WASM 及英文模型仍能识别 HELLO WORLD');
    console.log('\n自检全部通过。可双击“启动文档助手.cmd”。');
    console.log('此自检不调用收费翻译 API；联网翻译需接收者自己的网络和 Key。');
  } finally {
    if (child && child.exitCode === null) child.kill();
  }
})().catch(error => { console.error('自检失败：' + error.message); process.exitCode = 1; });
