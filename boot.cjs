const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

function check() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此包适用于 Windows 10/11 64 位系统。');
  for (const name of ['app/文档助手服务.js', 'app/英文数据手册阅读助手.html',
    'app/文档布局.mjs', 'app/阅读器主程序.mjs', 'app/页面重建.mjs', 'app/tables.mjs', 'app/电子术语表.js', 'app/DeepSeek请求.ps1', 'app/翻译请求.ps1',
    'app/文档助手依赖/eng.traineddata', 'app/文档助手依赖/pdf.mjs',
    'app/文档助手依赖/pdf.worker.mjs', 'app/文档助手依赖/pdf-lib.min.js', 'assets/example.pdf']) {
    if (!fs.existsSync(path.join(__dirname, name))) throw new Error('缺少文件，请完整解压：' + name);
  }
  require(require.resolve('tesseract.js', { paths: [path.join(__dirname, 'app')] }));
  const shell = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (shell.status !== 0 || Number(shell.stdout.trim()) < 5) throw new Error('需要 Windows 自带的 PowerShell 5.1 或更高版本。');
}
async function freePort(start = 8766) {
  for (let port = start; port < start + 30; port++) {
    const free = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('本地端口均被占用，请关闭其他文档助手窗口后重试。');
}
if (require.main === module) {
  (async () => {
    check();
    process.env.PORT = String(await freePort());
    process.env.OPEN_BROWSER = process.env.DOC_ASSISTANT_NO_BROWSER === '1' ? '0' : '1';
    console.log('文档助手便携版 · 请保持此窗口开启，关闭窗口即可退出。');
    console.log('PDF 阅读与 OCR 可离线使用；翻译及余额查询需要联网。');
    require('./app/文档助手服务.js');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { check, freePort };
