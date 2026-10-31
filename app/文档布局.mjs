export function splitColumns(rows, page) {
  const middle = page.width / 2;
  const result = [];
  for (const row of rows) {
    if (!row.parts?.length) { result.push(row); continue; }
    const left = row.parts.filter(part => part.x < middle);
    const right = row.parts.filter(part => part.x >= middle);
    if (!left.length || !right.length) { result.push(row); continue; }
    for (const parts of [left, right]) {
      const x = Math.min(...parts.map(part => part.x));
      result.push({ ...row, parts, x,
        width: Math.max(...parts.map(part => part.x + part.width)) - x + 4,
        text: parts.map(part => part.text).join(' ').replace(/\s+/g, ' ').trim() });
    }
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function buildBlocks(rows, page) {
  const blocks = [];
  for (const row of rows) {
    const top = row.y - row.height * .9;
    const right = row.x + row.width;
    let best = null;
    let score = -1;
    for (const block of blocks) {
      const gap = top - block.bottom;
      if (gap < -.25 * row.height || gap > Math.max(row.height, block.lineHeight) * .75) continue;
      if (Math.max(row.height, block.lineHeight) / Math.min(row.height, block.lineHeight) > 1.45) continue;
      const overlap = Math.min(right, block.right) - Math.max(row.x, block.x);
      const closeStart = Math.abs(row.x - block.x) < Math.max(row.height, block.lineHeight) * 2;
      if (overlap < Math.min(row.width, block.right - block.x) * .3 && !closeStart) continue;
      const candidate = overlap - Math.abs(gap) * 2;
      if (candidate > score) { best = block; score = candidate; }
    }
    if (best && best.text.length + row.text.length > 800) best = null;
    if (best) {
      best.text += ' ' + row.text;
      best.right = Math.max(best.right, right);
      best.x = Math.min(best.x, row.x);
      best.bottom = Math.max(best.bottom, row.y + row.height * .2);
      best.lineHeight = row.height;
      best.rows.push(row);
    } else {
      blocks.push({ x: row.x, top, right, bottom: row.y + row.height * .2,
        lineHeight: row.height, text: row.text, rows: [row] });
    }
  }
  blocks.sort((a, b) => a.top - b.top || a.x - b.x);
  const result = blocks.map(block => {
    const later = blocks.filter(other => other !== block && other.top >= block.bottom &&
      Math.min(other.right, block.right) > Math.max(other.x, block.x));
    const nextTop = Math.min(page.height, ...later.map(other => other.top));
    const originalHeight = block.bottom - block.top;
    const height = Math.max(originalHeight, Math.min(nextTop - block.top - 2, originalHeight * 1.25));
    return { text: block.text, x: Math.max(0, block.x - 2), y: Math.max(0, block.top - 2),
      width: Math.min(page.width - block.x + 2, block.right - block.x + 5),
      height: Math.min(page.height - block.top + 2, height + 4), fontSize: block.rows[0].height * .85,
      sourceRows: block.rows };
  });
  for (const block of result) {
    const following = result.filter(other => other.y > block.y &&
      Math.min(other.x + other.width, block.x + block.width) > Math.max(other.x, block.x));
    if (following.length) block.height = Math.min(block.height, Math.min(...following.map(other => other.y)) - block.y - 2);
    block.height = Math.max(4, block.height);
  }
  return result;
}

export function fitBlock(ctx, text, block, scale = 1) {
  const width = block.width * scale - 4;
  const height = block.height * scale - 3;
  let font = Math.min(block.fontSize * scale, 22 * scale);
  for (; font >= 7 * scale; font -= .35 * scale) {
    ctx.font = `${font}px "Microsoft YaHei", sans-serif`;
    const lines = [];
    let line = '';
    for (const character of text) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    if (line) lines.push(line);
    if (lines.length * font * 1.12 <= height) return { font, lines };
  }
  return null;
}
