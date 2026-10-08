(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.IELTSStudyApp = api;
  if (root.document && root.IELTS_DATA) api.init(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VIEWS = ['p2', 'p1', 'p3', 'stories'];
  const DEFAULT_PREFERENCES = Object.freeze({
    answerMode: 'full',
    fontSize: 'normal',
    rate: 1,
    playbackMode: 'continuous',
  });

  function createBrowseContexts() {
    return Object.fromEntries(VIEWS.map(view => [
      view,
      {
        query: '',
        category: '全部',
        onlyUnlearned: false,
        selectedId: null,
        listScrollTop: 0,
        readerScrollY: 0,
        keepReadingAfterRemoval: false,
      },
    ]));
  }

  function normalizeSearch(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function itemSearchText(item) {
    const questions = Array.isArray(item.questions)
      ? item.questions.flatMap(question => [question.q, question.q_zh, question.a])
      : [];
    return normalizeSearch([
      item.id,
      item.masterId,
      item.title,
      item.topic,
      item.prompt_en,
      item.title_en,
      item.category,
      item.keywords,
      item.tags,
      item.script,
      questions,
    ].flat(Infinity).filter(Boolean).join(' '));
  }

  function buildSearchIndexes(collections) {
    const indexes = {};
    for (const view of VIEWS) {
      for (const item of collections[view] || []) {
        indexes[`${view}:${item.id}`] = itemSearchText(item);
      }
    }
    return indexes;
  }

  function filterItems({ view, items, context, learned, indexes }) {
    const tokens = normalizeSearch(context.query).split(' ').filter(Boolean);
    return items.filter(item => {
      if (context.category !== '全部' && item.category !== context.category) return false;
      if (context.onlyUnlearned && learned[`${view}:${item.id}`]) return false;
      const index = indexes[`${view}:${item.id}`] || '';
      return tokens.every(token => index.includes(token));
    });
  }

  function parseRoute(hash) {
    const [candidateView, candidateId] = String(hash || '').replace(/^#/, '').split('/');
    if (!VIEWS.includes(candidateView)) return { view: 'p2', id: null };
    return { view: candidateView, id: candidateId || null };
  }

  function sanitizePreferences(value) {
    const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      answerMode: ['full', 'cues'].includes(candidate.answerMode)
        ? candidate.answerMode
        : DEFAULT_PREFERENCES.answerMode,
      fontSize: ['small', 'normal', 'large'].includes(candidate.fontSize)
        ? candidate.fontSize
        : DEFAULT_PREFERENCES.fontSize,
      rate: [0.8, 1, 1.2, 1.5].includes(Number(candidate.rate))
        ? Number(candidate.rate)
        : DEFAULT_PREFERENCES.rate,
      playbackMode: ['continuous', 'repeat', 'single'].includes(candidate.playbackMode)
        ? candidate.playbackMode
        : DEFAULT_PREFERENCES.playbackMode,
    };
  }

  function createQueueSnapshot(view, items, context) {
    return {
      items: items
        .filter(item => item.audio)
        .map(item => ({
          view,
          id: item.id,
          title: item.title || item.topic,
          audio: item.audio,
        })),
      context: {
        view,
        query: String(context.query || ''),
        category: String(context.category || '全部'),
        onlyUnlearned: Boolean(context.onlyUnlearned),
        total: items.filter(item => item.audio).length,
      },
    };
  }

  function stepQueueIndex(index, direction, length) {
    if (!Number.isInteger(index) || !Number.isInteger(length) || length < 1) return -1;
    return Math.max(0, Math.min(length - 1, index + direction));
  }

  function reconcileSelectedId({ selectedId, items, mobile, filterChanged }) {
    if (!filterChanged && selectedId) return selectedId;
    if (selectedId && items.some(item => item.id === selectedId)) return selectedId;
    return mobile ? null : (items[0]?.id || null);
  }

  function nextListScrollTop({ mobile, mobileScreen, saved, current }) {
    return mobile && mobileScreen !== 'list' ? saved : current;
  }

  function classifyPlaybackFailure(name) {
    if (name === 'AbortError') return 'ignore';
    if (name === 'NotAllowedError') return 'autoplay';
    return 'media';
  }

  function validateProgressImport(payload, collections) {
    if (!payload || typeof payload !== 'object' || payload.version !== 1) {
      return { valid: {}, ignored: 0, error: '不支持的进度文件版本' };
    }
    if (!payload.learned || typeof payload.learned !== 'object' || Array.isArray(payload.learned)) {
      return { valid: {}, ignored: 0, error: '进度内容格式无效' };
    }
    const validIds = new Set();
    for (const view of VIEWS) {
      for (const item of collections[view] || []) validIds.add(`${view}:${item.id}`);
    }
    const valid = {};
    let ignored = 0;
    for (const [key, value] of Object.entries(payload.learned)) {
      if (validIds.has(key) && typeof value === 'boolean') valid[key] = value;
      else ignored += 1;
    }
    return { valid, ignored, error: null };
  }

  function init(root) {
    const document = root.document;
    const data = root.IELTS_DATA;
    const transcriptSync = root.TranscriptSync;
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]));
    const asArray = value => Array.isArray(value) ? value : [value].filter(Boolean);
    const collections = {
      p2: data.topics,
      p1: data.part1,
      p3: data.part3,
      stories: data.masters,
    };
    const viewLabels = {
      p2: 'Part 2',
      p1: 'Part 1',
      p3: 'Part 3',
      stories: '共用故事',
    };
    const noteLabels = {
      p2: '按题查看完整稿，先熟悉主线，再开口复述。',
      p1: `${data.part1.length} 个主题，每个主题两组短问答。`,
      p3: `${data.part3.length} 个主题，练习观点、原因、例子和比较。`,
      stories: '先记故事主线，再练对应题目的完整版本。',
    };
    const contexts = createBrowseContexts();
    const indexes = buildSearchIndexes(collections);
    const mobileMedia = root.matchMedia('(max-width: 767px)');
    const reducedMotion = root.matchMedia('(prefers-reduced-motion: reduce)');
    const progressKey = 'ielts-speaking-progress-v2';
    const preferencesKey = 'ielts-speaking-ui-v1';
    const lastItemKey = 'ielts-speaking-last-item-v1';
    let view = 'p2';
    let mobileScreen = 'list';
    let learned = {};
    let preferences = { ...DEFAULT_PREFERENCES };
    let lastItem = null;
    let revealedQuestionIndexes = new Set();
    let storageOK = true;
    let storageNoticeShown = false;
    let searchTimer = 0;
    let composing = false;
    let routeKey = '';
    let importCandidate = null;
    let transcriptSegments = [];
    let transcriptTimeline = [];
    let transcriptCursor = 0;
    let activeTranscriptIndex = -1;

    const player = {
      queue: [],
      queueContext: null,
      index: -1,
      status: 'idle',
      followReader: true,
      expanded: false,
      requestId: 0,
    };
    const audio = $('audio');

    function readJSON(key, fallback) {
      try {
        const raw = root.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        storageOK = false;
        return fallback;
      }
    }

    function writeJSON(key, value) {
      try {
        root.localStorage.setItem(key, JSON.stringify(value));
        storageOK = true;
        return true;
      } catch {
        storageOK = false;
        if (!storageNoticeShown) {
          storageNoticeShown = true;
          toast('当前浏览器无法保存进度和偏好，本次打开仍可正常练习');
        }
        return false;
      }
    }

    function loadStoredState() {
      const storedProgress = readJSON(progressKey, {});
      learned = storedProgress && typeof storedProgress === 'object' && !Array.isArray(storedProgress)
        ? storedProgress
        : {};
      preferences = sanitizePreferences(readJSON(preferencesKey, DEFAULT_PREFERENCES));
      const storedLastItem = readJSON(lastItemKey, null);
      lastItem = isValidItemReference(storedLastItem) ? storedLastItem : null;
    }

    function isValidItemReference(reference) {
      return Boolean(
        reference
        && VIEWS.includes(reference.view)
        && collections[reference.view].some(item => item.id === reference.id),
      );
    }

    function currentContext() {
      return contexts[view];
    }

    function currentItems() {
      return collections[view] || [];
    }

    function selectedItem() {
      const selectedId = currentContext().selectedId;
      return currentItems().find(item => item.id === selectedId) || null;
    }

    function filtered(viewName = view) {
      return filterItems({
        view: viewName,
        items: collections[viewName],
        context: contexts[viewName],
        learned,
        indexes,
      });
    }

    function progressKeyFor(viewName, item) {
      return `${viewName}:${item.id}`;
    }

    function wordCount(value) {
      return asArray(value).join(' ').match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g)?.length || 0;
    }

    function fullEnglishAnswer(item, viewName = view) {
      if (viewName === 'p1' || viewName === 'p3') {
        return item.questions.map(question => `${question.q}\n${asArray(question.a).join('\n')}`).join('\n\n');
      }
      return asArray(item.script).join('\n\n');
    }

    function toast(message) {
      const element = $('toast');
      element.textContent = message;
      element.hidden = false;
      root.clearTimeout(toast.timer);
      toast.timer = root.setTimeout(() => {
        element.hidden = true;
      }, 2600);
    }

    function savePreferences() {
      writeJSON(preferencesKey, preferences);
    }

    function saveProgress() {
      writeJSON(progressKey, learned);
    }

    function saveLastItem(reference) {
      lastItem = reference;
      writeJSON(lastItemKey, reference);
    }

    function saveListScroll() {
      const context = currentContext();
      context.listScrollTop = nextListScrollTop({
        mobile: mobileMedia.matches,
        mobileScreen,
        saved: context.listScrollTop,
        current: mobileMedia.matches ? root.scrollY : $('list').scrollTop,
      });
    }

    function restoreListScroll() {
      const top = currentContext().listScrollTop || 0;
      root.requestAnimationFrame(() => {
        if (mobileMedia.matches) root.scrollTo({ top, behavior: 'auto' });
        else $('list').scrollTop = top;
      });
    }

    function saveReaderScroll() {
      if (mobileScreen === 'reader') currentContext().readerScrollY = root.scrollY;
    }

    function setRoute(viewName, id, mode = 'push') {
      const next = `#${viewName}${id ? `/${id}` : ''}`;
      routeKey = next;
      if (root.location.hash === next) return;
      if (mode === 'replace') root.history.replaceState(null, '', next);
      else root.history.pushState(null, '', next);
    }

    function renderTabsAndChrome() {
      document.querySelectorAll('[data-view]').forEach(button => {
        const active = button.dataset.view === view;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      $('practice-panel').setAttribute('aria-labelledby', `tab-${view}`);
      $('topnote').textContent = noteLabels[view];
      const context = currentContext();
      $('search').value = context.query;
      $('clear-search').hidden = !context.query;
      $('only-unlearned').setAttribute('aria-pressed', String(context.onlyUnlearned));

      const categories = ['全部', ...new Set(currentItems().map(item => item.category).filter(Boolean))];
      $('filters').hidden = categories.length === 1;
      $('filters').innerHTML = categories.map(category => `
        <button class="chip ${context.category === category ? 'active' : ''}"
          type="button" data-category="${escape(category)}"
          aria-pressed="${context.category === category}">${escape(category)}</button>
      `).join('');
    }

    function reconcileSelectionForResults(items) {
      const context = currentContext();
      if (context.keepReadingAfterRemoval && selectedItem()) return;
      const nextId = reconcileSelectedId({
        selectedId: context.selectedId,
        items,
        mobile: mobileMedia.matches,
        filterChanged: true,
      });
      if (nextId !== context.selectedId) revealedQuestionIndexes = new Set();
      context.selectedId = nextId;
    }

    function renderList() {
      const context = currentContext();
      const items = filtered();
      const learnedCount = currentItems().filter(item => learned[progressKeyFor(view, item)]).length;
      $('listcount').textContent = `当前结果 ${items.length} / ${currentItems().length} · 已背 ${learnedCount}`;
      $('only-unlearned').setAttribute('aria-pressed', String(context.onlyUnlearned));

      if (!items.length) {
        const queryDescription = context.query ? `搜索“${escape(context.query)}”` : '当前条件';
        $('list').innerHTML = `
          <div class="empty">
            ${queryDescription}没有找到题目。
            <div class="empty-actions">
              ${context.query ? '<button class="btn" type="button" id="empty-clear-search">清空搜索</button>' : ''}
              <button class="btn" type="button" id="reset-filters">重置全部筛选</button>
            </div>
          </div>
        `;
      } else {
        $('list').innerHTML = items.map(item => {
          const active = context.selectedId === item.id;
          const itemMeta = item.masterId
            ? `共用 ${item.masterId}`
            : (view === 'stories' ? `${wordCount(item.script)} 词` : `${item.questions?.length || 0} 组问答`);
          return `
            <button class="item ${active ? 'selected' : ''}" type="button"
              data-id="${escape(item.id)}" aria-current="${active ? 'true' : 'false'}">
              <span class="itemtitle">${escape(item.title || item.topic)}</span>
              ${item.prompt_en || item.title_en
                ? `<span class="item-en" lang="en">${escape(item.prompt_en || item.title_en)}</span>`
                : ''}
              <span class="meta"><span>${escape(item.category || item.id)}</span><span>${escape(itemMeta)}</span></span>
              ${learned[progressKeyFor(view, item)] ? '<span class="tick" aria-label="已背">✓</span>' : ''}
            </button>
          `;
        }).join('');
      }
      renderResume();
    }

    function renderResume() {
      const element = $('resume');
      if (player.queue.length || !lastItem || lastItem.view !== view) {
        element.hidden = true;
        element.innerHTML = '';
        return;
      }
      const item = collections[lastItem.view].find(candidate => candidate.id === lastItem.id);
      if (!item) {
        element.hidden = true;
        return;
      }
      element.hidden = false;
      element.innerHTML = `
        <p>继续上次练习</p>
        <button type="button" data-resume-view="${escape(lastItem.view)}" data-resume-id="${escape(item.id)}">
          ${escape(item.title || item.topic)}
        </button>
      `;
    }

    function transcriptText(text) {
      return transcriptSync.splitTranscript([text]).map(segment => `
        <span class="transcript-sentence" data-transcript-index="${transcriptCursor++}"
          role="button" tabindex="0">${escape(segment.text)}</span>
      `).join(' ');
    }

    function transcriptParagraphs(value) {
      return asArray(value).map(text => `<p lang="en">${transcriptText(text)}</p>`).join('');
    }

    function plainParagraphs(value) {
      return asArray(value).map(text => `<p lang="en">${escape(text)}</p>`).join('');
    }

    function renderQAContent(item) {
      if (preferences.answerMode === 'full') {
        return item.questions.map(question => `
          <section>
            <h3 class="question" lang="en">${transcriptText(question.q)}</h3>
            <p class="question-zh">${escape(question.q_zh || '')}</p>
            <div class="english">${transcriptParagraphs(question.a)}</div>
          </section>
        `).join('');
      }
      return item.questions.map((question, index) => {
        const revealed = revealedQuestionIndexes.has(index);
        return `
          <section class="qa-cue">
            <h3 class="question" lang="en">${escape(question.q)}</h3>
            <p class="question-zh">${escape(question.q_zh || '')}</p>
            ${revealed
              ? `<div class="english">${plainParagraphs(question.a)}</div>`
              : `<button class="btn" type="button" data-reveal-answer="${index}">看这题答案</button>`}
          </section>
        `;
      }).join('');
    }

    function renderStoryContent(item, master) {
      if (preferences.answerMode === 'full') {
        return `<div class="english">${transcriptParagraphs(item.script)}</div>`;
      }
      const cues = item.keywords || master?.keywords;
      return `
        <div class="cue-card">
          ${cues
            ? `<strong>根据记忆线复述</strong><p>${escape(cues)}</p>`
            : '<p>暂未提供记忆线，可查看全文后自行复述。</p>'}
          <button class="btn" type="button" id="show-full-answer">显示全文</button>
        </div>
      `;
    }

    function playerItem() {
      return player.queue[player.index] || null;
    }

    function isPlayingSelection() {
      const playing = playerItem();
      const selected = selectedItem();
      return Boolean(playing && selected && playing.view === view && playing.id === selected.id);
    }

    function readerListenLabel() {
      if (!player.queue.length) return '▶ 开始听读';
      if (isPlayingSelection()) return audio.paused ? '▶ 继续播放' : 'Ⅱ 暂停';
      return '▶ 播放本题';
    }

    function renderReader() {
      const item = selectedItem();
      const reader = $('reader');
      if (!item) {
        transcriptSegments = [];
        transcriptTimeline = [];
        activeTranscriptIndex = -1;
        reader.innerHTML = '<div class="empty reader-placeholder">选一道题，开始练习。</div>';
        return;
      }

      const isQA = view === 'p1' || view === 'p3';
      const isStory = view === 'stories';
      const master = isStory ? item : data.masters.find(candidate => candidate.id === item.masterId);
      transcriptCursor = 0;
      activeTranscriptIndex = -1;
      const transcriptSource = isQA
        ? item.questions.flatMap(question => [question.q, ...asArray(question.a)])
        : asArray(item.script);
      transcriptSegments = transcriptSync.splitTranscript(transcriptSource);
      const body = isQA ? renderQAContent(item) : renderStoryContent(item, master);
      const related = !isQA
        ? data.topics.filter(topic => topic.masterId === (isStory ? item.id : item.masterId))
        : [];
      const followups = !isQA && master?.followups?.length
        ? `
          <details>
            <summary>追问（${master.followups.length} 组）</summary>
            ${master.followups.map(question => `
              <h3 class="question" lang="en">${escape(question.q)}</h3>
              <p class="question-zh">${escape(question.q_zh || '')}</p>
              <div class="english">${plainParagraphs(question.a)}</div>
            `).join('')}
          </details>
        `
        : '';
      const sources = (master?.verified_sources || []).map(source => {
        const url = typeof source === 'string' ? source : (source.url || source.href);
        const label = typeof source === 'string' ? '核验资料' : (source.title || source.label || '核验资料');
        return url && /^https?:\/\//.test(url)
          ? `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a></li>`
          : '';
      }).join('');
      const results = filtered();
      const resultIndex = results.findIndex(candidate => candidate.id === item.id);
      const removedFromUnlearned = currentContext().keepReadingAfterRemoval && resultIndex < 0;
      const previous = resultIndex > 0 ? results[resultIndex - 1] : null;
      const next = resultIndex >= 0 && resultIndex < results.length - 1 ? results[resultIndex + 1] : null;
      const fontLabel = ({ small: '小', normal: '标准', large: '大' })[preferences.fontSize];
      const playing = playerItem();
      const listeningDifference = playing && !isPlayingSelection()
        ? `
          <div class="listening-difference" role="status">
            <span>正在听“${escape(playing.title)}”，正在看“${escape(item.title || item.topic)}”</span>
            <button class="btn" type="button" data-return-playing>返回正在播放</button>
          </div>
        `
        : '';

      reader.innerHTML = `
        <div class="reader-inner">
          <nav class="reader-nav" aria-label="阅读导航">
            <button class="reader-back" id="back" type="button">← 题库</button>
            <span class="reader-section">${viewLabels[view]}</span>
            <div class="more-panel">
              <button class="reader-more" id="more-open" type="button" aria-expanded="false"
                aria-controls="more-popover">更多</button>
              <div class="more-popover" id="more-popover" hidden>
                <button type="button" id="copy">复制全文</button>
                <button type="button" id="font-size">字号：${fontLabel}</button>
                <button type="button" id="open-sources">题库来源与使用说明</button>
              </div>
            </div>
          </nav>
          ${removedFromUnlearned
            ? '<div class="removed-notice" role="status">已标记，已从未背列表移除。正文与当前音频保持不变。</div>'
            : ''}
          ${listeningDifference}
          <h2 tabindex="-1" id="reader-title">${escape(item.title || item.topic)}</h2>
          ${item.prompt_en || item.title_en
            ? `<p class="prompt-en" lang="en">${escape(item.prompt_en || item.title_en)}</p>`
            : ''}
          <div class="readermeta">
            <span>${escape(item.category || item.id)}</span>
            <span>${isQA
              ? `${item.questions.length} 组练习问答`
              : `${wordCount(item.script)} 词${item.masterId ? ` · 共用 ${escape(item.masterId)}` : ''}`}
            </span>
          </div>
          <p class="notice">个人经历为练习样例，可替换为你熟悉的细节。</p>
          <div class="reader-tools">
            <div class="mode-switch" aria-label="答案显示模式">
              <button type="button" id="mode-full" aria-pressed="${preferences.answerMode === 'full'}">阅读</button>
              <button type="button" id="mode-cues" aria-pressed="${preferences.answerMode === 'cues'}">背诵</button>
            </div>
            <div class="reader-secondary">
              <button class="btn primary" id="listen" type="button">${readerListenLabel()}</button>
              <button class="btn copy-inline" id="copy-inline" type="button">复制全文</button>
              <button class="btn font-inline" id="font-size-inline" type="button">字号：${fontLabel}</button>
              <button class="btn ${learned[progressKeyFor(view, item)] ? 'active' : ''}" id="mark"
                type="button" aria-pressed="${Boolean(learned[progressKeyFor(view, item)])}">
                ${learned[progressKeyFor(view, item)] ? '✓ 已背' : '标记已背'}
              </button>
            </div>
          </div>
          ${!isQA
            ? `
              <details class="keywords">
                <summary>记忆线</summary>
                <div>${escape(item.keywords || master?.keywords || '暂未提供记忆线，可查看全文后自行复述')}</div>
              </details>
            `
            : ''}
          ${body}
          ${item.note ? `<p class="smalltext">${escape(item.note)}</p>` : ''}
          ${!isQA && !isStory && master
            ? `<div class="sectiontitle">共用故事</div>
              <button class="btn" type="button" data-master="${escape(master.id)}">${escape(`${master.id} ${master.title}`)}</button>`
            : ''}
          ${related.length
            ? `<details><summary>共用故事与相关题（${related.length}）</summary>
              <div class="related">${related.map(topic => `
                <button type="button" data-topic="${escape(topic.id)}">${escape(topic.title)}</button>
              `).join('')}</div></details>`
            : ''}
          ${followups}
          ${isStory && item.variants?.length
            ? `<details><summary>换题时改变什么（${item.variants.length} 种）</summary>
              <div>${item.variants.map(variant => `
                <section><strong>${escape(variant.name)}</strong>
                <p class="smalltext">${escape(variant.omit || '按题目选择对应的完整版本。')}</p></section>
              `).join('')}</div></details>`
            : ''}
          ${sources
            ? `<details><summary>相关事实来源</summary><ul class="smalltext">${sources}</ul></details>`
            : ''}
          <nav class="reader-pager" aria-label="当前筛选结果导航">
            ${removedFromUnlearned
              ? '<button class="btn prev" id="back-unlearned" type="button">返回未背题库</button>'
              : `<button class="btn prev" type="button" data-reader-id="${escape(previous?.id || '')}"
                  ${previous ? '' : 'disabled'}>上一题</button>`}
            <span class="reader-position">${resultIndex >= 0 ? `当前结果第 ${resultIndex + 1} / ${results.length} 题` : ''}</span>
            ${removedFromUnlearned
              ? ''
              : `<button class="btn next ${next ? 'primary' : ''}" type="button"
                  data-reader-id="${escape(next?.id || '')}" ${next ? '' : 'disabled'}>下一题</button>`}
          </nav>
        </div>
      `;
      document.documentElement.style.setProperty(
        '--reader-font-size',
        ({ small: '17px', normal: '19px', large: '21px' })[preferences.fontSize],
      );
      refreshTranscriptTimeline();
      syncTranscriptToPlayback({ scroll: false });
    }

    function renderProgress() {
      $('progress-grid').innerHTML = VIEWS.map(viewName => {
        const total = collections[viewName].length;
        const complete = collections[viewName].filter(item => learned[`${viewName}:${item.id}`]).length;
        return `
          <div class="progress-stat">
            <span>${viewLabels[viewName]}</span>
            <strong>${complete} / ${total}</strong>
          </div>
        `;
      }).join('');
    }

    function render() {
      $('app').classList.toggle('reading', mobileMedia.matches && mobileScreen === 'reader');
      renderTabsAndChrome();
      renderList();
      renderReader();
      renderProgress();
      renderPlayer();
    }

    function resetCurrentFilters() {
      contexts[view] = {
        ...createBrowseContexts()[view],
      };
      $('search').value = '';
      userChangedBrowseContext();
      reconcileSelectionForResults(filtered());
      render();
    }

    function userChangedBrowseContext() {
      currentContext().keepReadingAfterRemoval = false;
      revealedQuestionIndexes = new Set();
      if (player.queue.length) player.followReader = false;
      if (mobileMedia.matches) mobileScreen = 'list';
    }

    function switchView(nextView, { origin = 'user', writeRoute = true } = {}) {
      if (!VIEWS.includes(nextView)) return;
      saveListScroll();
      saveReaderScroll();
      view = nextView;
      mobileScreen = 'list';
      revealedQuestionIndexes = new Set();
      if (origin === 'user') userChangedBrowseContext();
      reconcileSelectionForResults(filtered());
      render();
      if (writeRoute) setRoute(view, null, 'push');
      restoreListScroll();
    }

    function openItem(viewName, id, { origin = 'user', writeRoute = true, focus = true } = {}) {
      if (!VIEWS.includes(viewName)) return false;
      const item = collections[viewName].find(candidate => candidate.id === id);
      if (!item) return false;
      if (origin === 'user') {
        saveListScroll();
        if (player.queue.length && (playerItem()?.view !== viewName || playerItem()?.id !== id)) {
          player.followReader = false;
        }
      }
      const changed = view !== viewName || contexts[viewName].selectedId !== id;
      view = viewName;
      contexts[viewName].selectedId = id;
      contexts[viewName].keepReadingAfterRemoval = false;
      mobileScreen = 'reader';
      if (changed) revealedQuestionIndexes = new Set();
      saveLastItem({ view: viewName, id });
      render();
      if (writeRoute) setRoute(viewName, id, origin === 'playback' ? 'replace' : 'push');
      if (origin !== 'route') root.scrollTo({ top: 0, behavior: 'auto' });
      if (focus && mobileMedia.matches) root.requestAnimationFrame(() => $('reader-title')?.focus());
      return true;
    }

    function returnToList({ writeRoute = true } = {}) {
      saveReaderScroll();
      mobileScreen = 'list';
      render();
      if (writeRoute) setRoute(view, null, 'push');
      root.requestAnimationFrame(() => {
        const selectedId = currentContext().selectedId;
        const target = selectedId ? document.querySelector(`[data-id="${root.CSS?.escape ? root.CSS.escape(selectedId) : selectedId}"]`) : null;
        (target || $('list-title')).focus?.({ preventScroll: true });
        root.requestAnimationFrame(restoreListScroll);
      });
    }

    function applyRouteFromLocation() {
      const parsed = parseRoute(root.location.hash);
      const nextKey = `#${parsed.view}${parsed.id ? `/${parsed.id}` : ''}`;
      if (nextKey === routeKey && parsed.view === view && parsed.id === currentContext().selectedId) return;
      routeKey = nextKey;
      if (parsed.id) {
        if (!openItem(parsed.view, parsed.id, { origin: 'route', writeRoute: false, focus: false })) {
          view = parsed.view;
          mobileScreen = 'list';
          render();
          toast('题目不存在，已返回题库');
          setRoute(view, null, 'replace');
        }
      } else {
        view = parsed.view;
        mobileScreen = 'list';
        render();
        restoreListScroll();
      }
    }

    function markSelected() {
      const item = selectedItem();
      if (!item) return;
      const key = progressKeyFor(view, item);
      learned[key] = !learned[key];
      saveProgress();
      if (currentContext().onlyUnlearned) {
        currentContext().keepReadingAfterRemoval = Boolean(learned[key]);
        if (learned[key]) toast('已标记，已从未背列表移除');
      }
      render();
    }

    async function copySelected() {
      const item = selectedItem();
      if (!item) return;
      const content = fullEnglishAnswer(item);
      try {
        if (root.navigator.clipboard?.writeText) await root.navigator.clipboard.writeText(content);
        else {
          const textarea = document.createElement('textarea');
          textarea.value = content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.append(textarea);
          textarea.select();
          if (!document.execCommand('copy')) throw new Error('copy');
          textarea.remove();
        }
        toast('全文已复制');
      } catch {
        toast('复制未成功，请长按文字选择复制');
      }
    }

    function setAnswerMode(answerMode) {
      preferences.answerMode = answerMode;
      savePreferences();
      renderReader();
    }

    function cycleFontSize() {
      const sizes = ['small', 'normal', 'large'];
      preferences.fontSize = sizes[(sizes.indexOf(preferences.fontSize) + 1) % sizes.length];
      savePreferences();
      renderReader();
      $('more-open')?.setAttribute('aria-expanded', 'false');
    }

    function refreshTranscriptTimeline() {
      transcriptTimeline = isPlayingSelection()
        ? transcriptSync.createTimeline(transcriptSegments, audio.duration)
        : [];
    }

    function setActiveTranscript(index, { scroll = true } = {}) {
      const changed = index !== activeTranscriptIndex;
      activeTranscriptIndex = index;
      document.querySelectorAll('[data-transcript-index]').forEach((element, position) => {
        element.classList.toggle('is-active', position === index);
        element.classList.toggle('is-past', index >= 0 && position < index);
        if (position === index) element.setAttribute('aria-current', 'true');
        else element.removeAttribute('aria-current');
      });
      if (changed && scroll && player.followReader && index >= 0) {
        document.querySelector(`[data-transcript-index="${index}"]`)?.scrollIntoView({
          behavior: reducedMotion.matches ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }
    }

    function syncTranscriptToPlayback({ scroll = true } = {}) {
      if (!transcriptTimeline.length) {
        setActiveTranscript(-1, { scroll: false });
        return;
      }
      setActiveTranscript(transcriptSync.findActiveSegment(transcriptTimeline, audio.currentTime), { scroll });
    }

    function seekToTranscript(index) {
      if (!Number.isInteger(index) || index < 0) return;
      const applySeek = () => {
        refreshTranscriptTimeline();
        const segment = transcriptTimeline[index];
        if (!segment) return;
        audio.currentTime = segment.start;
        syncTranscriptToPlayback();
        audio.play().catch(() => {
          $('audio-status').textContent = '点播放键继续。';
        });
      };
      if (!isPlayingSelection()) {
        audio.addEventListener('loadedmetadata', applySeek, { once: true });
        startListening();
      } else if (audio.readyState >= 1) applySeek();
      else audio.addEventListener('loadedmetadata', applySeek, { once: true });
    }

    function queueContextLabel() {
      if (!player.queueContext) return '';
      const category = player.queueContext.category === '全部' ? '' : ` · ${player.queueContext.category}`;
      return `${viewLabels[player.queueContext.view]}${category} · ${player.queue.length} 条音频`;
    }

    function renderPlayer() {
      const dock = $('audio-dock');
      if (!player.queue.length) {
        dock.hidden = true;
        document.body.classList.remove('has-audio');
        document.documentElement.style.setProperty('--audio-dock-height', '0px');
        return;
      }
      dock.hidden = false;
      document.body.classList.add('has-audio');
      const item = playerItem();
      $('audio-title').textContent = item?.title || '';
      $('audio-toggle').textContent = audio.paused ? '▶' : 'Ⅱ';
      $('audio-toggle').setAttribute('aria-label', audio.paused ? '播放' : '暂停');
      $('audio-expanded').hidden = !player.expanded;
      $('audio-expand').setAttribute('aria-expanded', String(player.expanded));
      $('audio-expand').textContent = player.expanded ? '收起' : '展开';
      $('audio-prev').disabled = player.index <= 0;
      $('audio-next').disabled = player.index >= player.queue.length - 1;
      $('audio-next-compact').disabled = player.index >= player.queue.length - 1;
      $('audio-rate').value = String(preferences.rate);
      $('audio-mode').value = preferences.playbackMode;
      $('audio-follow').setAttribute('aria-pressed', String(player.followReader));
      $('audio-follow').textContent = player.followReader ? '✓ 跟随正文' : '跟随正文';
      const mismatch = !isPlayingSelection();
      $('audio-context').innerHTML = `${escape(queueContextLabel())}${mismatch
        ? ` · 正在听“${escape(item.title)}”，正在看“${escape(selectedItem()?.title || selectedItem()?.topic || '题库')}” <button class="btn" data-return-playing type="button">返回正在播放</button>`
        : ''}`;
      root.requestAnimationFrame(updateDockHeight);
    }

    function updateReaderPlaybackControl() {
      const listen = $('listen');
      if (listen) listen.textContent = readerListenLabel();
    }

    function updateDockHeight() {
      const dock = $('audio-dock');
      const height = dock.hidden ? 0 : Math.ceil(dock.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--audio-dock-height', `${height}px`);
    }

    function followPlayingItem() {
      const item = playerItem();
      if (!item) return;
      player.followReader = true;
      const snapshot = player.queueContext;
      if (snapshot) {
        contexts[snapshot.view].query = snapshot.query;
        contexts[snapshot.view].category = snapshot.category;
        contexts[snapshot.view].onlyUnlearned = snapshot.onlyUnlearned;
        contexts[snapshot.view].keepReadingAfterRemoval = false;
      }
      openItem(item.view, item.id, { origin: 'playback', writeRoute: true });
      renderPlayer();
    }

    function startListening() {
      const item = selectedItem();
      if (!item?.audio) {
        toast('这篇音频正在准备，请稍后刷新');
        return;
      }
      if (isPlayingSelection()) {
        if (audio.paused) {
          const requestId = player.requestId;
          audio.play().catch(error => handlePlaybackFailure(error, requestId));
        }
        else audio.pause();
        return;
      }
      const visible = filtered();
      const snapshot = createQueueSnapshot(view, visible, currentContext());
      player.queue = snapshot.items;
      player.queueContext = snapshot.context;
      player.index = player.queue.findIndex(candidate => candidate.id === item.id);
      if (player.index < 0) {
        player.queue = [{ view, id: item.id, title: item.title || item.topic, audio: item.audio }];
        player.index = 0;
        player.queueContext.total = 1;
      }
      player.followReader = true;
      playCurrentAudio({ autoplay: true });
    }

    function handlePlaybackFailure(error, requestId = player.requestId) {
      if (requestId !== player.requestId) return;
      const kind = classifyPlaybackFailure(error?.name);
      if (kind === 'ignore') return;
      if (kind === 'autoplay') {
        player.status = 'paused';
        $('audio-status').textContent = '浏览器阻止了自动播放，请点播放键继续。';
      } else {
        player.status = 'error';
        $('audio-status').innerHTML = '音频加载失败，请检查网络。 <button class="btn" id="audio-retry" type="button">重试</button>';
      }
      renderPlayer();
    }

    function playCurrentAudio({ autoplay }) {
      const item = playerItem();
      if (!item) return;
      const requestId = ++player.requestId;
      const shouldFollow = player.followReader;
      audio.pause();
      player.status = 'loading';
      $('audio-status').textContent = '正在加载音频 · --:--';
      if (shouldFollow) followPlayingItem();
      audio.src = item.audio;
      audio.playbackRate = preferences.rate;
      audio.loop = preferences.playbackMode === 'repeat';
      if ('mediaSession' in root.navigator) {
        try {
          root.navigator.mediaSession.metadata = new root.MediaMetadata({
            title: item.title,
            artist: '雅思口语备考',
            album: 'Daniel 英式朗读',
          });
        } catch {}
      }
      renderPlayer();
      if (autoplay) {
        audio.play().catch(error => {
          handlePlaybackFailure(error, requestId);
        });
      }
    }

    function stepAudio(direction, { autoplay = !audio.paused } = {}) {
      if (!player.queue.length) return;
      const next = stepQueueIndex(player.index, direction, player.queue.length);
      if (next === player.index) {
        toast(direction > 0 ? '已到队列最后一篇' : '已到队列第一篇');
        renderPlayer();
        return;
      }
      player.index = next;
      playCurrentAudio({ autoplay });
    }

    function retryAudio() {
      const requestId = ++player.requestId;
      player.status = 'loading';
      $('audio-status').textContent = '正在重新加载音频 · --:--';
      audio.load();
      audio.play().catch(error => handlePlaybackFailure(error, requestId));
    }

    function closePlayer() {
      player.requestId += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      player.queue = [];
      player.queueContext = null;
      player.index = -1;
      player.status = 'idle';
      transcriptTimeline = [];
      setActiveTranscript(-1, { scroll: false });
      renderPlayer();
      renderResume();
    }

    function updatePreferenceFromPlayer() {
      preferences.rate = Number($('audio-rate').value);
      preferences.playbackMode = $('audio-mode').value;
      audio.playbackRate = preferences.rate;
      audio.loop = preferences.playbackMode === 'repeat';
      savePreferences();
    }

    function exportProgress() {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        learned,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = root.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ielts-speaking-progress-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      root.URL.revokeObjectURL(url);
    }

    async function previewProgressImport(file) {
      try {
        const payload = JSON.parse(await file.text());
        const result = validateProgressImport(payload, collections);
        const preview = $('import-preview');
        preview.hidden = false;
        if (result.error) {
          importCandidate = null;
          preview.textContent = result.error;
          return;
        }
        importCandidate = result.valid;
        preview.innerHTML = `
          <p>可导入 ${Object.keys(result.valid).length} 条，忽略 ${result.ignored} 条。</p>
          <button class="btn primary" type="button" id="confirm-import">确认合并</button>
          <button class="btn" type="button" id="cancel-import">取消</button>
        `;
      } catch {
        importCandidate = null;
        $('import-preview').hidden = false;
        $('import-preview').textContent = '无法读取此进度文件';
      }
    }

    function confirmProgressImport() {
      if (!importCandidate) return;
      learned = { ...learned, ...importCandidate };
      saveProgress();
      importCandidate = null;
      $('import-preview').hidden = true;
      render();
      toast('有效进度已合并');
    }

    function renderSources() {
      $('sources-content').innerHTML = `
        <p>资料整理：2026年10月7日。${data.topics.length} 个题型是本季汇编与补充主题的练习范围，
        不代表官方完整题库或迪拜必考题。英文题干为训练用概括，中文帮助理解题意。</p>
        <p>先熟悉主线，再练换题和追问。Daniel 英式英语音频适合边听边背，之后仍要练习自己开口。</p>
        <p>${storageOK ? '已背进度保存在当前浏览器，不会自动同步到另一台设备。' : '浏览器存储当前不可用，进度和偏好仅在本次打开期间有效。'}</p>
        <ul>${data.sources.map(source => `
          <li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a></li>
        `).join('')}</ul>
      `;
    }

    function handleSearchInput() {
      if (composing) return;
      root.clearTimeout(searchTimer);
      searchTimer = root.setTimeout(() => {
        saveListScroll();
        currentContext().query = normalizeSearch($('search').value);
        userChangedBrowseContext();
        reconcileSelectionForResults(filtered());
        renderTabsAndChrome();
        renderList();
        renderReader();
        renderPlayer();
      }, 150);
    }

    function handleTabKeyboard(event) {
      const currentIndex = VIEWS.indexOf(view);
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % VIEWS.length;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + VIEWS.length) % VIEWS.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = VIEWS.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextView = VIEWS[nextIndex];
      switchView(nextView);
      $(`tab-${nextView}`).focus();
    }

    function closeMorePopover({ restoreFocus = false } = {}) {
      const popover = $('more-popover');
      const trigger = $('more-open');
      if (!popover || !trigger) return;
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }

    document.addEventListener('click', event => {
      if (!$('more-popover')?.hidden && !event.target.closest('.more-panel')) closeMorePopover();
      const sentence = event.target.closest('[data-transcript-index]');
      if (sentence) {
        seekToTranscript(Number(sentence.dataset.transcriptIndex));
        return;
      }
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.view) switchView(button.dataset.view);
      else if (button.dataset.category) {
        saveListScroll();
        currentContext().category = button.dataset.category;
        userChangedBrowseContext();
        reconcileSelectionForResults(filtered());
        render();
        restoreListScroll();
      } else if (button.dataset.id) {
        openItem(view, button.dataset.id);
      } else if (button.dataset.readerId) {
        openItem(view, button.dataset.readerId);
      } else if (button.dataset.master) {
        openItem('stories', button.dataset.master);
      } else if (button.dataset.topic) {
        openItem('p2', button.dataset.topic);
      } else if (button.dataset.resumeId) {
        openItem(button.dataset.resumeView, button.dataset.resumeId);
      } else if (button.dataset.revealAnswer !== undefined) {
        revealedQuestionIndexes.add(Number(button.dataset.revealAnswer));
        renderReader();
      } else if (button.id === 'back' || button.id === 'back-unlearned') returnToList();
      else if (button.id === 'mark') markSelected();
      else if (button.id === 'mode-full' || button.id === 'show-full-answer') setAnswerMode('full');
      else if (button.id === 'mode-cues') setAnswerMode('cues');
      else if (button.id === 'copy' || button.id === 'copy-inline') {
        if (button.id === 'copy') closeMorePopover();
        copySelected();
      }
      else if (button.id === 'listen') startListening();
      else if (button.id === 'only-unlearned') {
        saveListScroll();
        currentContext().onlyUnlearned = !currentContext().onlyUnlearned;
        userChangedBrowseContext();
        reconcileSelectionForResults(filtered());
        render();
        restoreListScroll();
      } else if (button.id === 'random') {
        const items = filtered();
        if (items.length) openItem(view, items[Math.floor(Math.random() * items.length)].id);
        else toast('当前筛选下没有题目');
      } else if (button.id === 'empty-clear-search') {
        currentContext().query = '';
        $('search').value = '';
        userChangedBrowseContext();
        reconcileSelectionForResults(filtered());
        render();
        $('search').focus();
      } else if (button.id === 'reset-filters') resetCurrentFilters();
      else if (button.id === 'clear-search') {
        currentContext().query = '';
        $('search').value = '';
        userChangedBrowseContext();
        reconcileSelectionForResults(filtered());
        render();
        $('search').focus();
      } else if (button.id === 'more-open') {
        const open = button.getAttribute('aria-expanded') !== 'true';
        $('more-popover').hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) $('more-popover').querySelector('button')?.focus();
      } else if (button.id === 'font-size' || button.id === 'font-size-inline') cycleFontSize();
      else if (button.id === 'open-sources') {
        closeMorePopover();
        returnToList();
        $('sources').open = true;
        $('sources').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      } else if (button.id === 'progress-open') $('progress-dialog').showModal();
      else if (button.id === 'progress-close') $('progress-dialog').close();
      else if (button.id === 'export-progress') exportProgress();
      else if (button.id === 'import-progress-button') $('import-progress').click();
      else if (button.id === 'confirm-import') confirmProgressImport();
      else if (button.id === 'cancel-import') {
        importCandidate = null;
        $('import-preview').hidden = true;
      } else if (button.id === 'audio-toggle') {
        if (audio.paused) {
          const requestId = player.requestId;
          audio.play().catch(error => handlePlaybackFailure(error, requestId));
        }
        else audio.pause();
      } else if (button.id === 'audio-prev') stepAudio(-1);
      else if (button.id === 'audio-next' || button.id === 'audio-next-compact') stepAudio(1);
      else if (button.id === 'audio-expand') {
        player.expanded = !player.expanded;
        renderPlayer();
      } else if (button.id === 'audio-close') closePlayer();
      else if (button.id === 'audio-title' || button.hasAttribute('data-return-playing')) followPlayingItem();
      else if (button.id === 'audio-follow') {
        player.followReader = !player.followReader;
        if (player.followReader) followPlayingItem();
        else renderPlayer();
      } else if (button.id === 'audio-retry') retryAudio();
    });

    document.addEventListener('keydown', event => {
      const sentence = event.target.closest?.('[data-transcript-index]');
      if (sentence && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        seekToTranscript(Number(sentence.dataset.transcriptIndex));
        return;
      }
      if (event.target.matches?.('[role="tab"]')) handleTabKeyboard(event);
      if (event.key === 'Escape' && !$('more-popover')?.hidden) {
        event.preventDefault();
        closeMorePopover({ restoreFocus: true });
      }
    });

    $('search').addEventListener('input', handleSearchInput);
    $('search').addEventListener('compositionstart', () => {
      composing = true;
    });
    $('search').addEventListener('compositionend', () => {
      composing = false;
      handleSearchInput();
    });
    $('search').addEventListener('focus', () => {
      if (mobileMedia.matches && player.expanded) {
        player.expanded = false;
        renderPlayer();
      }
    });
    $('audio-rate').addEventListener('change', updatePreferenceFromPlayer);
    $('audio-mode').addEventListener('change', updatePreferenceFromPlayer);
    $('import-progress').addEventListener('change', event => {
      const [file] = event.target.files;
      if (file) previewProgressImport(file);
      event.target.value = '';
    });

    audio.addEventListener('loadstart', () => {
      player.status = 'loading';
      $('audio-status').textContent = '正在加载音频 · --:--';
    });
    audio.addEventListener('loadedmetadata', () => {
      player.status = audio.paused ? 'paused' : 'playing';
      $('audio-status').textContent = '';
      refreshTranscriptTimeline();
      syncTranscriptToPlayback({ scroll: false });
    });
    audio.addEventListener('playing', () => {
      player.status = 'playing';
      $('audio-status').textContent = '';
      renderPlayer();
      updateReaderPlaybackControl();
    });
    audio.addEventListener('pause', () => {
      if (player.status !== 'idle' && player.status !== 'loading') player.status = 'paused';
      renderPlayer();
      updateReaderPlaybackControl();
    });
    audio.addEventListener('waiting', () => {
      player.status = 'waiting';
      $('audio-status').textContent = '正在缓冲音频…';
    });
    audio.addEventListener('ended', () => {
      if (preferences.playbackMode === 'continuous' && player.index < player.queue.length - 1) {
        stepAudio(1, { autoplay: true });
      } else {
        player.status = 'paused';
        $('audio-status').textContent = '本次播放已结束。';
        renderPlayer();
      }
    });
    audio.addEventListener('error', () => {
      if (!player.queue.length) return;
      player.status = 'error';
      $('audio-status').innerHTML = '音频加载失败，请检查网络。 <button class="btn" id="audio-retry" type="button">重试</button>';
      renderPlayer();
    });
    audio.addEventListener('durationchange', refreshTranscriptTimeline);
    audio.addEventListener('timeupdate', () => syncTranscriptToPlayback());
    audio.addEventListener('seeking', () => syncTranscriptToPlayback());

    root.addEventListener('popstate', applyRouteFromLocation);
    root.addEventListener('hashchange', applyRouteFromLocation);
    root.addEventListener('beforeunload', () => {
      saveListScroll();
      saveReaderScroll();
    });
    mobileMedia.addEventListener?.('change', render);
    const resizeObserver = root.ResizeObserver ? new root.ResizeObserver(updateDockHeight) : null;
    resizeObserver?.observe($('audio-dock'));

    if ('mediaSession' in root.navigator) {
      const actions = {
        play: () => audio.play().catch(() => {}),
        pause: () => audio.pause(),
        previoustrack: () => stepAudio(-1),
        nexttrack: () => stepAudio(1),
        seekbackward: details => {
          audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
        },
        seekforward: details => {
          audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (details.seekOffset || 10));
        },
        seekto: details => {
          if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime;
        },
      };
      for (const [action, handler] of Object.entries(actions)) {
        try {
          root.navigator.mediaSession.setActionHandler(action, handler);
        } catch {}
      }
    }

    const modelContext = document.modelContext;
    if (modelContext?.registerTool) {
      Promise.resolve(modelContext.registerTool({
        name: 'mark_ielts_topic_learned',
        title: '标记雅思题目已背',
        description: '更新当前设备上指定雅思题目的已背状态，并打开该题。',
        inputSchema: {
          type: 'object',
          properties: {
            view: { type: 'string', enum: VIEWS },
            id: { type: 'string' },
            learned: { type: 'boolean' },
          },
          required: ['view', 'id', 'learned'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || !isValidItemReference(input) || typeof input.learned !== 'boolean') {
            throw new Error('题目或状态无效');
          }
          learned[`${input.view}:${input.id}`] = input.learned;
          saveProgress();
          openItem(input.view, input.id);
          return { id: input.id, learned: input.learned, deviceLocal: true };
        },
      })).catch(() => {});
    }

    loadStoredState();
    renderSources();
    const rawRouteView = root.location.hash.replace(/^#/, '').split('/')[0];
    const route = parseRoute(root.location.hash);
    view = route.view;
    contexts[view].selectedId = route.id;
    if (!route.id && !mobileMedia.matches) contexts[view].selectedId = collections[view][0]?.id || null;
    preferences = sanitizePreferences(preferences);
    $('audio-rate').value = String(preferences.rate);
    $('audio-mode').value = preferences.playbackMode;
    audio.playbackRate = preferences.rate;
    audio.loop = preferences.playbackMode === 'repeat';
    if (route.id && !collections[view].some(item => item.id === route.id)) {
      contexts[view].selectedId = null;
      toast('题目不存在，已返回题库');
      setRoute(view, null, 'replace');
    } else if (root.location.hash && !VIEWS.includes(rawRouteView)) {
      setRoute('p2', null, 'replace');
    } else if (route.id) {
      mobileScreen = 'reader';
    }
    routeKey = root.location.hash || `#${view}${route.id ? `/${route.id}` : ''}`;
    render();
    if (!storageOK && !storageNoticeShown) {
      storageNoticeShown = true;
      toast('浏览器存储不可用，进度和偏好仅在本次打开期间有效');
    }
    if (route.id && mobileMedia.matches) root.requestAnimationFrame(() => $('reader-title')?.focus());
  }

  return {
    DEFAULT_PREFERENCES,
    buildSearchIndexes,
    createBrowseContexts,
    createQueueSnapshot,
    classifyPlaybackFailure,
    filterItems,
    init,
    nextListScrollTop,
    normalizeSearch,
    parseRoute,
    reconcileSelectedId,
    sanitizePreferences,
    stepQueueIndex,
    validateProgressImport,
  };
});
