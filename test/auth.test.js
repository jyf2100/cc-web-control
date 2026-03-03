const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../auth');

test('parseCookieHeader parses simple cookie pairs', () => {
  const cookies = auth.parseCookieHeader('a=1; b=hello%20world; cc_web_auth=test');
  assert.equal(cookies.a, '1');
  assert.equal(cookies.b, 'hello world');
  assert.equal(cookies.cc_web_auth, 'test');
});

test('safeEqual compares strings with same content', () => {
  assert.equal(auth.safeEqual('abc', 'abc'), true);
  assert.equal(auth.safeEqual('abc', 'abcd'), false);
  assert.equal(auth.safeEqual('abc', 'abC'), false);
});

test('extractBearerToken reads Authorization: Bearer ...', () => {
  assert.equal(auth.extractBearerToken('Bearer token123'), 'token123');
  assert.equal(auth.extractBearerToken('bearer   token123  '), 'token123');
  assert.equal(auth.extractBearerToken('Basic xxx'), null);
});

test('isAuthorized allows when auth disabled', () => {
  assert.equal(auth.isAuthorized({ cookieHeader: '', authorizationHeader: '' }, ''), true);
  assert.equal(auth.isAuthorized({ cookieHeader: '', authorizationHeader: '' }, null), true);
});

test('isAuthorized accepts bearer token', () => {
  const ok = auth.isAuthorized({ cookieHeader: '', authorizationHeader: 'Bearer s3cr3t' }, 's3cr3t');
  assert.equal(ok, true);
});

test('isAuthorized accepts cookie token', () => {
  const ok = auth.isAuthorized({ cookieHeader: 'cc_web_auth=s3cr3t', authorizationHeader: '' }, 's3cr3t');
  assert.equal(ok, true);
});

test('isSameOrigin matches exact origin', () => {
  assert.equal(auth.isSameOrigin('https://example.com', { protocol: 'https', host: 'example.com' }), true);
  assert.equal(auth.isSameOrigin('https://example.com', { protocol: 'http', host: 'example.com' }), false);
  assert.equal(auth.isSameOrigin('https://evil.com', { protocol: 'https', host: 'example.com' }), false);
});

