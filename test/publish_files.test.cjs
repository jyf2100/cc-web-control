'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

test('public/ 下每个 HTML 引用的本地资源都存在', () => {
  const htmlFiles = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
  assert.ok(htmlFiles.length > 0, '应至少有一个 html');
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
      .map(m => m[1])
      .filter(r => !/^(https?:|data:|#|\/)/.test(r));
    for (const r of refs) {
      const resolved = path.normalize(path.join(PUB, r));
      assert.ok(
        fs.existsSync(resolved),
        `${f} 引用 "${r}"，但 ${resolved} 不存在`
      );
    }
  }
});

test('关键运行资源在 public/ 内', () => {
  for (const f of ['index.html', 'client.js', 'dashboard.html', 'login.html', 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(PUB, f)), `缺 ${f}`);
  }
});
