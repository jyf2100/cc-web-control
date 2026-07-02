'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, callHub } = require('../hub/mcp/stdio.cjs');

test('buildRequest: list_sessions → GET', () => {
  assert.deepEqual(buildRequest('list_sessions'), { path: '/api/mcp/list_sessions', method: 'GET' });
});

test('buildRequest: read_session 带 query', () => {
  const r = buildRequest('read_session', { machine: 'm1', session: 's1', lines: 50 });
  assert.equal(r.method, 'GET');
  assert.match(r.path, /machine=m1/);
  assert.match(r.path, /session=s1/);
  assert.match(r.path, /lines=50/);
});

test('buildRequest: ack_event 带 body', () => {
  const r = buildRequest('ack_event', { runId: 'run-1', outcome: 'advised: x' });
  assert.equal(r.method, 'POST');
  assert.deepEqual(JSON.parse(r.body), { runId: 'run-1', outcome: 'advised: x' });
});

test('buildRequest: 未知工具抛错', () => {
  assert.throws(() => buildRequest('nope'), /unknown tool/);
});

test('callHub: ok → 解析 JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"a":1}' });
  const out = await callHub(buildRequest('list_sessions'), { hubUrl: 'http://x', token: 't', fetchImpl });
  assert.deepEqual(out, { a: 1 });
});

test('callHub: 非 ok → 抛错(含状态)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
  await assert.rejects(
    () => callHub(buildRequest('list_sessions'), { hubUrl: 'http://x', token: 't', fetchImpl }),
    /502/,
  );
});

test('callHub: 带 Authorization header', async () => {
  let got;
  const fetchImpl = async (url, init) => { got = { url, init }; return { ok: true, status: 200, text: async () => '{}' }; };
  await callHub(buildRequest('list_sessions'), { hubUrl: 'http://x', token: 'TOK', fetchImpl });
  assert.equal(got.init.headers.Authorization, 'Bearer TOK');
});
