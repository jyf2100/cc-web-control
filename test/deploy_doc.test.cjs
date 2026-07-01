'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '部署使用文档.md'), 'utf8');

test('无硬编码 /Volumes/work 绝对路径', () => {
  assert.ok(!/\/Volumes\/work\//.test(doc), '仍含 /Volumes/work/ 硬编码路径');
});

test('部署文档非空', () => {
  assert.ok(doc.length > 100);
});
