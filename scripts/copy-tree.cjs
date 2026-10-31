const fs = require('node:fs');
const path = require('node:path');
module.exports = function copyTree(source, target, skip = () => false) {
  if (skip(source)) return;
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) module.exports(path.join(source, name), path.join(target, name), skip);
  } else fs.copyFileSync(source, target);
};
