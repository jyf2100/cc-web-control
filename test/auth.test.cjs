const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../auth.cjs');

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

test('normalizeNextPath allows only safe relative paths', () => {
  assert.equal(auth.normalizeNextPath('/'), '/');
  assert.equal(auth.normalizeNextPath('/?session=claude-1'), '/?session=claude-1');
  assert.equal(auth.normalizeNextPath('/login?next=%2F'), '/login?next=%2F');
  assert.equal(auth.normalizeNextPath('https://evil.com/'), null);
  assert.equal(auth.normalizeNextPath('//evil.com/'), null);
  assert.equal(auth.normalizeNextPath('javascript:alert(1)'), null);
  assert.equal(auth.normalizeNextPath(''), null);
});

test('isAuthorized accepts custom cookie name (hub)', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_hub_auth=hubtok', authorizationHeader: '' },
    'hubtok',
    'cc_web_hub_auth'
  );
  assert.equal(ok, true);
});

test('isAuthorized default cookie name still works (single-machine)', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_auth=tok', authorizationHeader: '' },
    'tok'
  );
  assert.equal(ok, true);
});

test('isAuthorized ignores wrong-name cookie', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_auth=tok', authorizationHeader: '' },
    'tok',
    'cc_web_hub_auth'
  );
  assert.equal(ok, false);
});
