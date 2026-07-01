'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('含 npx 快速开始', () => {
  assert.ok(/npx cc-web-control/.test(readme));
});

test('声明需 tmux 与 claude 前置依赖', () => {
  assert.ok(/tmux/.test(readme));
  assert.ok(/claude/i.test(readme));
});

test('声明需 Node.js >= 18', () => {
  assert.ok(/1[8-9]|[2-9][0-9]/.test(readme));
});

test('无硬编码 /Users/pan 绝对路径', () => {
  assert.ok(!/\/Users\/pan\//.test(readme), '仍含 /Users/pan/ 硬编码路径');
});
