const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const copyTree = require('./copy-tree.cjs');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('请在 Windows x64 上构建便携包。');
const destination = path.join(root, 'dist/datasheet-pdf-translator-Windows64');
if (fs.existsSync(destination)) throw new Error('输出文件夹已存在。请先另存旧版，再重新打包：' + destination);
const app = path.join(destination, 'app');
fs.mkdirSync(app, { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'app'))) {
  if (name === 'node_modules') continue;
  copyTree(path.join(root, 'app', name), path.join(app, name));
}
for (const name of ['assets', 'checks', 'licenses']) copyTree(path.join(root, name), path.join(destination, name));
fs.mkdirSync(path.join(destination, 'scripts'));
for (const name of ['start.cjs', 'selfcheck.cjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(destination, 'scripts', name));
for (const name of ['boot.cjs', 'README.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(root, name), path.join(destination, name));
fs.mkdirSync(path.join(destination, 'runtime'));
fs.copyFileSync(process.execPath, path.join(destination, 'runtime/node.exe'));
const copied = new Map();
function copyPackage(name, from) {
  const resolver = createRequire(path.join(from, 'package.json'));
  const directory = (resolver.resolve.paths(name) || []).map(p => path.join(p, name)).find(p => fs.existsSync(path.join(p, 'package.json')));
  if (!directory) throw new Error('缺少依赖：' + name);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (copied.has(name)) {
    if (copied.get(name) !== metadata.version) throw new Error('依赖版本冲突：' + name);
    return;
  }
  copied.set(name, metadata.version);
  copyTree(directory, path.join(app, 'node_modules', name), file => path.relative(directory, file).split(path.sep).includes('node_modules'));
  for (const dependency of Object.keys(metadata.dependencies || {})) copyPackage(dependency, directory);
}
copyPackage('tesseract.js', root);
function command(name, script) {
  fs.writeFileSync(path.join(destination, name), ['@echo off', 'setlocal', 'chcp 65001 >nul', 'pushd "%~dp0"', 'set "NODE_PATH="', 'set "NODE_OPTIONS="', '"runtime\\node.exe" "' + script + '"', 'if errorlevel 1 pause', 'popd', 'endlocal', ''].join('\r\n'));
}
command('启动文档助手.cmd', 'scripts\\start.cjs');
command('检查运行环境.cmd', 'scripts\\selfcheck.cjs');
fs.writeFileSync(path.join(destination, '组件版本.json'), JSON.stringify({ platform: 'Windows x64', node: process.version, packages: Object.fromEntries(copied) }, null, 2));
const check = spawnSync(path.join(destination, 'runtime/node.exe'), [path.join(destination, 'scripts/selfcheck.cjs')], { windowsHide: true, encoding: 'utf8', timeout: 120000 });
fs.writeFileSync(path.join(destination, '交付自检记录.txt'), (check.stdout || '') + (check.stderr || ''));
if (check.status !== 0) throw new Error('便携包自检失败：' + check.stdout + check.stderr);
const entries = [];
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
  const file = path.join(directory, entry.name);
  if (entry.isDirectory()) walk(file);
  else { const data = fs.readFileSync(file); entries.push({ file: path.relative(destination, file).replaceAll('\\', '/'), bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }); }
} }
walk(destination);
fs.writeFileSync(path.join(destination, '文件校验清单.json'), JSON.stringify(entries, null, 2));
console.log('便携包已生成并通过离线自检：' + destination);
