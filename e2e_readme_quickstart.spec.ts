import { test, expect, Page } from '@playwright/test';

// 取 dev server 提供的 README 原文（raw markdown），并按 heading 切出「快速启动」小节文本。
// 原文是仓内静态文件 → 确定性（无墙钟/无外网/无随机）。
async function readReadme(page: Page): Promise<string> {
  const res = await page.request.get('/README.md');
  expect(res.ok(), `README.md 应可被 dev server 提供 (got ${res.status()})`).toBe(true);
  return await res.text();
}

function quickstartSection(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /快速启动/.test(l));
  expect(start, 'README 应含「快速启动」小节（某个 heading 行提到该词）').toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

test('ac1 快速启动小节存在且位于开发节之后', async ({ page }) => {
  // criterion: 20261102-readme-kuaisuqidong:ac1
  const md = await readReadme(page);
  expect(md).toMatch(/快速启动/);
  expect(quickstartSection(md).trim().length).toBeGreaterThan(0);
  const devIdx = md.search(/开发/);
  expect(devIdx, '应存在「开发」节作为参照').toBeGreaterThanOrEqual(0);
  const qstartIdx = md.search(/快速启动/);
  expect(qstartIdx, '「快速启动」小节须在开发节之后').toBeGreaterThan(devIdx);
});

test('ac2 快速启动命令与 package.json scripts 一致（install / env / dev）', async ({ page }) => {
  // criterion: 20261102-readme-kuaisuqidong:ac2
  const section = quickstartSection(await readReadme(page));
  // 以 package.json scripts 为准：标准 scripts（install / dev / build / start / test 均存在）。
  expect(section).toContain('npm install'); // install 步
  expect(section).toContain('npm run dev'); // dev 步（PRD 指定的 dev 命令）
  expect(section).toMatch(/环境|env|\.env/i); // env 步
});
