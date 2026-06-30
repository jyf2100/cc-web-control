const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
test('client.js inlineInput 输入属性成套', () => {
    const js = fs.readFileSync('public/client.js', 'utf8');
    assert.ok(/setAttribute\('enterkeyhint',\s*'send'\)/.test(js));
    assert.ok(/setAttribute\('inputmode',\s*'text'\)/.test(js));
});
test('login.html token 输入属性成套', () => {
    const html = fs.readFileSync('public/login.html', 'utf8');
    assert.ok(/enterkeyhint="go"/.test(html));
    assert.ok(/autocomplete="off"/.test(html));
    assert.ok(/autocapitalize="none"/.test(html));
});
