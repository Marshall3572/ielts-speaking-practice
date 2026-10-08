const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helperPath = path.join(__dirname, '../docs/bilingual.js');
const bilingual = fs.existsSync(helperPath) ? require(helperPath) : {};

const item = { id: 'T001', title: '成功经历', script: [
  "I'm recognising my progress. It gives me confidence because I've kept trying.",
  'I learned to ask for help.',
] };
const entry = { paragraphs: [
  { source: item.script[0], heading: '进步带来信心', sentences: [
    { en: "I'm recognising my progress.", zh: '我正逐渐看到自己的进步。' },
    { en: "It gives me confidence because I've kept trying.", zh: '这让我有了信心，因为我一直在尝试。', skeleton: "It gives me confidence because ..." },
  ] },
  { source: item.script[1], heading: '学会主动求助', sentences: [
    { en: 'I learned to ask for help.', zh: '我学会了向别人求助。' },
  ] },
], tip: { sentence: "It gives me confidence because I've kept trying.", method: '先记信心，再用 because 接上坚持尝试的原因。' } };

test('bilingual alignment accepts the source and rejects stale English or missing translations', () => {
  assert.equal(typeof bilingual.validArticle, 'function', 'bilingual alignment is missing');
  assert.equal(bilingual.validArticle(item, entry), true);
  assert.equal(bilingual.validArticle({ ...item, script: [item.script[0] + ' Changed.', item.script[1]] }, entry), false);
  const mismatch = structuredClone(entry);
  mismatch.paragraphs[0].sentences[0].en = "I'm recognizing my progress.";
  assert.equal(bilingual.validArticle(item, mismatch), false);
  const missing = structuredClone(entry);
  missing.paragraphs[0].sentences[0].zh = '';
  assert.equal(bilingual.validArticle(item, missing), false);
  assert.equal(bilingual.validArticle(item, null), false);
});

test('bilingual reading preserves paragraph boundaries and indexes English alone for audio', () => {
  assert.equal(typeof bilingual.renderArticle, 'function', 'bilingual reading is missing');
  const english = [];
  const html = bilingual.renderArticle(entry, text => {
    english.push(text);
    return `<span data-transcript-index="${english.length - 1}">${text}</span>`;
  });
  assert.deepEqual(english, entry.paragraphs.flatMap(p => p.sentences.map(s => s.en)));
  assert.equal((html.match(/<blockquote\b/g) || []).length, 3);
  assert.equal((html.match(/<hr\b/g) || []).length, 1);
  assert.equal((html.match(/data-transcript-index=/g) || []).length, 3);
  assert.match(html, /第1段 · 进步带来信心/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /记忆骨架：/);
  assert.match(html, /记忆小贴士/);
});

test('copied memorisation Markdown keeps original spelling, punctuation and quotation pairs', () => {
  assert.equal(typeof bilingual.toMarkdown, 'function', 'bilingual copying is missing');
  const md = bilingual.toMarkdown(item, entry);
  assert.match(md, /\*\*第1段 · 进步带来信心\*\*/);
  assert.ok(md.includes("> I'm recognising my progress.\n> 我正逐渐看到自己的进步。\n\n> It gives me confidence because I've kept trying."));
  assert.ok(md.includes('> 记忆骨架：It gives me confidence because ...'));
  assert.equal((md.match(/^---$/gm) || []).length, 1);
  assert.ok(md.endsWith('先记信心，再用 because 接上坚持尝试的原因。\n'));
});

test('bilingual rendering escapes text from articles and memory hints', () => {
  assert.equal(typeof bilingual.renderArticle, 'function', 'bilingual reading is missing');
  const unsafe = structuredClone(entry);
  unsafe.paragraphs[0].sentences[0].zh = '<img src=x onerror=alert(1)> &';
  unsafe.tip.method = '<script>bad()</script>';
  const html = bilingual.renderArticle(unsafe, text => text);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&amp;'));
});
