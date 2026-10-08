(function (root, factory) {
  const sync = root.TranscriptSync || (typeof require === 'function' ? require('./transcript-sync.js') : null);
  const api = factory(sync);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.IELTSBilingual = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (sync) {
  'use strict';

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function validArticle(item, entry) {
    if (!sync || !Array.isArray(item?.script) || !Array.isArray(entry?.paragraphs)
      || item.script.length !== entry.paragraphs.length || !entry.tip?.method) return false;
    return entry.paragraphs.every((paragraph, index) => {
      if (paragraph.source !== item.script[index] || !/^[\p{Script=Han}]{4,8}$/u.test(paragraph.heading)
        || !Array.isArray(paragraph.sentences)) return false;
      const original = sync.splitTranscript([item.script[index]]);
      return original.length === paragraph.sentences.length && original.every((sentence, sentenceIndex) => {
        const pair = paragraph.sentences[sentenceIndex];
        return pair?.en === sentence.text && typeof pair.zh === 'string' && pair.zh.trim().length > 0;
      });
    }) && entry.paragraphs.some(paragraph => paragraph.sentences.some(pair => pair.en === entry.tip.sentence));
  }

  function memoryTip(entry) {
    return `最容易卡壳的是「${entry.tip.sentence}」。${entry.tip.method}`;
  }

  function renderArticle(entry, renderEnglish) {
    const paragraphs = entry.paragraphs.map((paragraph, index) => `
      <section class="bilingual-paragraph">
        <h3 class="paragraph-title"><strong>第${index + 1}段 · ${escape(paragraph.heading)}</strong></h3>
        ${paragraph.sentences.map(pair => `
          <blockquote class="sentence-pair">
            <p lang="en">${renderEnglish(pair.en)}</p>
            <p class="sentence-zh" lang="zh-CN">${escape(pair.zh)}</p>
            ${pair.skeleton ? `<p class="memory-skeleton"><span>记忆骨架：</span><span lang="en">${escape(pair.skeleton)}</span></p>` : ''}
          </blockquote>
        `).join('')}
      </section>
    `).join('<hr class="paragraph-divider">');
    return `<div class="english bilingual">${paragraphs}
      <aside class="memory-tip" aria-label="记忆小贴士">
        <strong>记忆小贴士</strong><p lang="zh-CN">${escape(memoryTip(entry))}</p>
      </aside>
    </div>`;
  }

  function toMarkdown(item, entry) {
    const paragraphs = entry.paragraphs.map((paragraph, index) => {
      const pairs = paragraph.sentences.map(pair => [
        `> ${pair.en}`, `> ${pair.zh}`,
        ...(pair.skeleton ? [`> 记忆骨架：${pair.skeleton}`] : []),
      ].join('\n')).join('\n\n');
      return `**第${index + 1}段 · ${paragraph.heading}**\n\n${pairs}`;
    }).join('\n\n---\n\n');
    return `# ${item.title || item.topic}\n\n${paragraphs}\n\n**记忆小贴士**：${memoryTip(entry)}\n`;
  }

  return { validArticle, renderArticle, toMarkdown };
});
