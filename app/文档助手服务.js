const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { phrases, words } = require('./电子术语表.js');
const { createWorker } = require('tesseract.js');

const root = __dirname;
const vendor = path.join(root, '文档助手依赖');
const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const files = {
  '/': [path.join(root, '英文数据手册阅读助手.html'), 'text/html; charset=utf-8'],
  '/vendor/pdf.mjs': [path.join(vendor, 'pdf.mjs'), 'text/javascript; charset=utf-8'],
  '/vendor/pdf.worker.mjs': [path.join(vendor, 'pdf.worker.mjs'), 'text/javascript; charset=utf-8'],
  '/vendor/pdf-lib.min.js': [path.join(vendor, 'pdf-lib.min.js'), 'text/javascript; charset=utf-8'],
  '/layout.mjs': [path.join(root, '文档布局.mjs'), 'text/javascript; charset=utf-8'],
  '/reader.mjs': [path.join(root, '阅读器主程序.mjs'), 'text/javascript; charset=utf-8'],
  '/tables.mjs': [path.join(root, 'tables.mjs'), 'text/javascript; charset=utf-8'],
  '/rebuild.mjs': [path.join(root, '页面重建.mjs'), 'text/javascript; charset=utf-8'],
  '/default.pdf': [path.join(root, '..', 'assets', 'example.pdf'), 'application/pdf'],
};
const port = Number(process.env.PORT || 8765);
const address = `http://127.0.0.1:${port}/`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextTranslationAt = 0;
let googleLimitedUntil = 0;
let ocrWorker;
let ocrQueue = Promise.resolve();
let deepseekKey = '';
let deepseekUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };

function runPowerShell(script, input, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, script)], { windowsHide: true });
    let output = '';
    let error = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || '请求失败'));
    });
    child.stdin.end(input);
  });
}

async function requestDeepSeekTranslation(lines, professional) {
  const payload = {
    model: 'deepseek-chat',
    temperature: 0,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Translate English PDF text into Simplified Chinese. Return only a JSON object with a translations array containing exactly one translated string for each input string, in the same order. Preserve numbers, units, formulas, citations, proper names, and pin identifiers such as VIN, CSN, DIM, SW and GND. Keep every [KEEP_N] placeholder exactly once, unchanged, in its original semantic position. Do not add explanations. ' + (professional ? 'Use standard electronics terminology: constant current driver=恒流驱动器, current sense resistor=电流采样电阻, pin=引脚, switching node=开关节点, standby state=待机状态, Parameter=参数, Symbol=符号, Conditions=测试条件, Min=最小值, Typ=典型值, Max=最大值, Unit=单位, Absolute Maximum Ratings=绝对最大额定值. Translate table cell descriptions independently; never move values between cells.' : ''),
      },
      { role: 'user', content: JSON.stringify({ lines }) },
    ],
  };
  const raw = await runPowerShell('DeepSeek请求.ps1', JSON.stringify({ key: deepseekKey, payload }));
  const response = JSON.parse(raw);
  if (response.usage) {
    for (const name of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
      deepseekUsage[name] += Number(response.usage[name] || 0);
    }
    deepseekUsage.requests++;
  }
  const choice = response.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('DeepSeek 译文被截断');
  const content = choice?.message?.content;
  if (!content) throw new Error('DeepSeek 未返回译文');
  let translated;
  try { translated = JSON.parse(content).translations; }
  catch { throw new Error('DeepSeek 译文格式不正确'); }
  if (!Array.isArray(translated) || translated.length !== lines.length || translated.some(item => typeof item !== 'string')) {
    throw new Error('DeepSeek 返回的译文数量与原文不一致');
  }
  if (translated.some(item => /[\uFFFD\u25A1\u25AF\u0000-\u0008]/u.test(item))) {
    throw new Error('DeepSeek 译文包含乱码');
  }
  return translated;
}

async function translateWithDeepSeek(lines, professional, firstLine = 1) {
  try {
    return await requestDeepSeekTranslation(lines, professional);
  } catch (error) {
    if (lines.length === 1 || !/译文数量与原文不一致|译文格式不正确|译文被截断|未返回译文|译文包含乱码/.test(error.message)) {
      throw new Error(`第 ${firstLine} 行：${error.message}`);
    }
    const middle = Math.ceil(lines.length / 2);
    const left = await translateWithDeepSeek(lines.slice(0, middle), professional, firstLine);
    const right = await translateWithDeepSeek(lines.slice(middle), professional, firstLine + middle);
    return left.concat(right);
  }
}

async function recognize(image, column = false) {
  if (!ocrWorker) ocrWorker = createWorker('eng', 1, {
    langPath: path.join(root, '文档助手依赖'),
    gzip: false,
    cacheMethod: 'none',
  });
  const worker = await ocrWorker;
  await worker.setParameters({ tessedit_pageseg_mode: column ? 6 : 3 });
  const { data } = await worker.recognize(image, {}, { blocks: true });
  return (data.blocks || []).flatMap((block, blockIndex) => (block.paragraphs || [])
    .flatMap((paragraph, paragraphIndex) => (paragraph.lines || []).map(line => ({
      ...line, paragraphId: blockIndex + ':' + paragraphIndex,
      blockId: blockIndex, paragraphBox: paragraph.bbox,
    }))))
    .filter(line => line.text?.trim() && line.confidence >= 30)
    .map(line => ({ text: line.text.trim(), bbox: line.bbox, confidence: line.confidence,
      paragraphId: line.paragraphId, blockId: line.blockId, paragraphBox: line.paragraphBox,
      words: (line.words || []).map(word => ({text:word.text,bbox:word.bbox,confidence:word.confidence})),
    }));
}

function openBrowser() {
  if (process.env.OPEN_BROWSER !== '1') return;
  const browser = spawn(path.join(windowsRoot, 'explorer.exe'), [address], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => console.error('无法自动打开浏览器：' + error.message + '；请手动访问 ' + address));
  browser.unref();
}

async function translate(text, professional = false) {
  if (!text.trim()) return '';
  const source = text;
  if (professional && /^(?:age of )?dim\b/i.test(text) && /lower than|higher than|voltage/i.test(text)) {
    text = text.replace(/^age of dim\b/i, 'voltage of DIM pin');
  }
  if (/[=±≤≥∑√]/.test(text) && !/[.!?]/.test(text)) return source;
  if (professional) {
    for (const [english, chinese] of [...phrases].sort((a, b) => b[0].length - a[0].length)) {
      const escaped = english.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), chinese);
    }
    text = text.replace(/\b(VIN|CSN|CS|DIM|SW|GND)\b/gi, (_, pin) => 'QZPIN' + pin.toUpperCase() + 'QZ');
  }
  const request = async url => {
    await wait(Math.max(0, nextTranslationAt - Date.now()));
    nextTranslationAt = Date.now() + 500;
    return new Promise((resolve, reject) => {
      const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, '翻译请求.ps1')], { windowsHide: true });
      let output = '';
      let error = '';
      const timeout = setTimeout(() => child.kill(), 20000);
      child.stdout.on('data', chunk => output += chunk);
      child.stderr.on('data', chunk => error += chunk);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || '翻译请求失败')); });
      child.stdin.end(url.toString());
    });
  };
  let result;
  if (Date.now() >= googleLimitedUntil) {
    const google = new URL('https://translate.googleapis.com/translate_a/single');
    google.search = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't', q: text }).toString();
    try {
      const data = JSON.parse(await request(google));
      result = data[0].map(part => part[0]).join('');
    } catch (error) {
      if (!/429|Too Many Requests/i.test(error.message)) throw error;
      googleLimitedUntil = Date.now() + 30 * 60 * 1000;
      console.warn('Google 翻译限流，临时切换备用翻译服务。');
    }
  }
  if (result === undefined) {
    const backup = new URL('https://api.mymemory.translated.net/get');
    backup.search = new URLSearchParams({ q: text, langpair: 'en|zh-CN' }).toString();
    const data = JSON.parse(await request(backup));
    if (data.responseStatus !== 200 || data.quotaFinished || !data.responseData?.translatedText) {
      throw new Error('备用翻译服务暂不可用或额度已用尽，请稍后重试');
    }
    result = data.responseData.translatedText;
  }
  if (professional) result = result.replace(/QZPIN(VIN|CSN|CS|DIM|SW|GND)QZ/gi, (_, pin) => pin.toUpperCase());
  if (professional && /standby state/i.test(source)) result = result.replace(/故障状态/g, '待机状态');
  return result;
}

async function translateBatch(lines, professional) {
  if(lines.some(line=>/\[KEEP_\d+\]/.test(line))){
    const fragments=[],pieces=lines.map(line=>line.split(/(\[KEEP_\d+\])/g).map(part=>{
      if(!/[A-Za-z]/.test(part)||/^\[KEEP_\d+\]$/.test(part))return {literal:part};
      return {index:fragments.push(part)-1};
    }));
    const translated=[];
    for(let start=0;start<fragments.length;start+=12)translated.push(...await translateBatch(fragments.slice(start,start+12),professional));
    return pieces.map(parts=>parts.map(p=>p.literal??translated[p.index]).join(' ').trim());
  }
  const marker = i => `QZROW${String(i).padStart(3, '0')}QZ`;
  const joined = lines.map((line, i) => marker(i) + ' ' + line).join('\n');
  const translated = await translate(joined, professional);
  const positions = [...translated.matchAll(/QZROW\s*(\d{3})\s*QZ/gi)];
  if (positions.length !== lines.length) throw new Error('批量译文行号丢失，请稍后重试');
  const result = [];
  for (let i = 0; i < positions.length; i++) {
    if (Number(positions[i][1]) !== i) throw new Error('批量译文行号顺序错误，请稍后重试');
    result.push(translated.slice(positions[i].index + positions[i][0].length, positions[i + 1]?.index).trim());
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/pdf-assets/')) {
    const resource = req.url.match(/^\/pdf-assets\/(cmaps|standard_fonts|wasm|iccs)\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)$/);
    if (!resource) { res.writeHead(404).end('Not found'); return; }
    const file = path.join(vendor, 'pdf-assets', resource[1], resource[2]);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : /\.(?:mjs|js)$/.test(file) ? 'text/javascript; charset=utf-8' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/api/deepseek/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ configured: Boolean(deepseekKey), usage: deepseekUsage }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/deepseek/balance') {
    if (!deepseekKey) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '请先配置 DeepSeek API Key' }));
      return;
    }
    try {
      const balance = JSON.parse(await runPowerShell('DeepSeek请求.ps1', JSON.stringify({ action: 'balance', key: deepseekKey }), 40000));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ is_available: balance.is_available, balance_infos: balance.balance_infos || [], usage: deepseekUsage }));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/deepseek/config') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1000) throw new Error('配置内容过长');
      }
      const { key } = JSON.parse(body);
      if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{8,}$/.test(key.trim())) throw new Error('请输入有效的 DeepSeek API Key');
      deepseekKey = key.trim();
      deepseekUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ configured: true }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.method === 'DELETE' && req.url === '/api/deepseek/config') {
    deepseekKey = '';
    deepseekUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ configured: false }));
    return;
  }
  if (req.method === 'GET' && files[req.url]) {
    const [file, type] = files[req.url];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/translate') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 200000) throw new Error('页面文字过长');
      }
      const { lines, professional = false } = JSON.parse(body);
      if (!Array.isArray(lines) || lines.length > 300 || lines.some(s => typeof s !== 'string' || s.length > 2000)) throw new Error('翻译请求格式不正确');
      const result = [];
      const batchSize = deepseekKey ? 4 : 8;
      for (let start = 0; start < lines.length; start += batchSize) {
        const part = lines.slice(start, start + batchSize);
        result.push(...(deepseekKey ? await translateWithDeepSeek(part, professional === true, start + 1) : await translateBatch(part, professional === true)));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ translations: result }));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/ocr') {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12_000_000) throw new Error('OCR 页面图像过大');
        chunks.push(chunk);
      }
      const image = Buffer.concat(chunks);
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('OCR 只接受 PNG 图像');
      const job = ocrQueue.then(() => recognize(image, req.headers['x-ocr-layout'] === 'column'));
      ocrQueue = job.catch(() => {});
      const rows = await job;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ rows }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/term') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 500) throw new Error('单词过长');
      }
      const { text, professional = false } = JSON.parse(body);
      if (typeof text !== 'string' || text.length > 400 || !/[A-Za-z]/.test(text)) throw new Error('请选择不超过 400 字符的英文');
      const selected = text.trim().replace(/\s+/g, ' ');
      const meaning = deepseekKey
        ? (await translateWithDeepSeek([selected], professional === true))[0]
        : professional && (words[selected] || words[selected.toLowerCase()]) || await translate(selected, professional === true);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ meaning }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  res.writeHead(404).end('Not found');
});

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(address + 'default.pdf', { signal: AbortSignal.timeout(2000) });
      if (response.ok && response.headers.get('content-type')?.includes('application/pdf')) {
        console.log('文档助手已在运行：' + address);
        openBrowser();
        return;
      }
    } catch {}
    console.error('端口 ' + port + ' 已被其他程序占用。');
  } else {
    console.error('文档助手启动失败：' + error.message);
  }
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log('文档助手：' + address);
  openBrowser();
});
