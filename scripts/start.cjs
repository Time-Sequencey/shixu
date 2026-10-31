const { check, freePort } = require('../boot.cjs');
(async () => {
  check();
  process.env.PORT = String(await freePort());
  process.env.OPEN_BROWSER = process.env.DOC_ASSISTANT_NO_BROWSER === '1' ? '0' : '1';
  console.log('文档助手：保持此窗口开启，关闭窗口即可退出。');
  require('../app/文档助手服务.js');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
