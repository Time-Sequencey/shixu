const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/文档助手服务.js'), 'utf8');
const functions = source.slice(source.indexOf('async function requestDeepSeekTranslation'), source.indexOf('async function recognize'));
let calls = [];
let reply;
const context = {
  deepseekKey: 'test-key',
  deepseekUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
  runPowerShell: async (_, input) => {
    const lines = JSON.parse(input).payload.messages[1].content;
    const items = JSON.parse(lines).lines;
    calls.push(items);
    return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: reply(items) }) } }] });
  },
};
vm.createContext(context);
vm.runInContext(functions + '\nthis.translateWithDeepSeek = translateWithDeepSeek;', context);

(async () => {
  reply = lines => lines.map(line => `译:${line}`);
  assert.deepEqual(Array.from(await context.translateWithDeepSeek(['a', 'b', 'c', 'd'], false)), ['译:a', '译:b', '译:c', '译:d']);
  assert.equal(calls.length, 1);

  calls = [];
  reply = lines => lines.length > 2 ? ['数量错误'] : lines.map(line => `译:${line}`);
  assert.deepEqual(Array.from(await context.translateWithDeepSeek(['a', 'b', 'c', 'd'], false)), ['译:a', '译:b', '译:c', '译:d']);
  assert.deepEqual(calls.map(items => items.length), [4, 2, 2]);

  calls = [];
  reply = lines => lines.length > 1 ? ['乱码□', '译:b'] : lines.map(line => `译:${line}`);
  assert.deepEqual(Array.from(await context.translateWithDeepSeek(['a', 'b'], false)), ['译:a', '译:b']);
  assert.deepEqual(calls.map(items => items.length), [2, 1, 1]);

  calls = [];
  reply = lines => lines.includes('b') ? [] : lines.map(line => `译:${line}`);
  await assert.rejects(context.translateWithDeepSeek(['a', 'b'], false, 7), /第 8 行：DeepSeek 返回的译文数量与原文不一致/);
  console.log('DeepSeek 分批测试通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
