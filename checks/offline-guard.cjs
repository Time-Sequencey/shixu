// Self-check only: reject network access so OCR cannot download missing assets.
const deny = () => { throw new Error('离线自检禁止网络请求：缺少本地资源'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = deny;
  module.get = deny;
}
