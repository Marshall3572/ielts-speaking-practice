const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../docs/app.js');

const collections = {
  p2: [
    {
      id: 'T001',
      title: '一次重要决定',
      prompt_en: 'Describe an important decision you were satisfied with.',
      category: '经历',
      masterId: 'M04',
      keywords: '小原型 测试成功',
      script: ['The final choice saved us time.'],
      audio: 'audio/T001.m4a',
    },
  ],
  p1: [
    {
      id: 'P101',
      topic: '工作学习',
      questions: [
        {
          q: 'What takes up most of your time at work?',
          q_zh: '你在工作中花时间最多的事情是什么？',
          a: 'Building useful applications takes up most of my time.',
        },
      ],
    },
  ],
  p3: [],
  stories: [],
};

test('buildSearchIndexes covers visible bilingual prompts, ids, master ids, and answers', () => {
  const indexes = app.buildSearchIndexes(collections);

  assert.match(indexes['p2:T001'], /describe an important decision/);
  assert.match(indexes['p2:T001'], /m04/);
  assert.match(indexes['p1:P101'], /你在工作中花时间最多/);
  assert.match(indexes['p1:P101'], /building useful applications/);
});

test('filterItems intersects category, unlearned state, and every search token', () => {
  const indexes = app.buildSearchIndexes(collections);
  const items = collections.p2.concat({
    id: 'T002',
    title: '另一个决定',
    prompt_en: 'Describe a quick choice.',
    category: '经历',
    masterId: 'M05',
    script: ['A short answer.'],
  });
  const allIndexes = app.buildSearchIndexes({ ...collections, p2: items });

  const result = app.filterItems({
    view: 'p2',
    items,
    context: {
      query: 'important M04',
      category: '经历',
      onlyUnlearned: true,
    },
    learned: { 'p2:T002': true },
    indexes: allIndexes,
  });

  assert.deepEqual(result.map(item => item.id), ['T001']);
  assert.deepEqual(
    app.filterItems({
      view: 'p2',
      items,
      context: { query: 'important missing', category: '经历', onlyUnlearned: false },
      learned: {},
      indexes,
    }),
    [],
  );
});

test('createBrowseContexts keeps independent filters for every section', () => {
  const contexts = app.createBrowseContexts();
  contexts.p2.query = 'decision';
  contexts.p2.category = '经历';

  assert.equal(contexts.p1.query, '');
  assert.equal(contexts.p1.category, '全部');
  assert.notEqual(contexts.p2, contexts.p1);
});

test('parseRoute keeps old hashes and safely falls back for unknown sections', () => {
  assert.deepEqual(app.parseRoute('#p2/T001'), { view: 'p2', id: 'T001' });
  assert.deepEqual(app.parseRoute('#stories/M04'), { view: 'stories', id: 'M04' });
  assert.deepEqual(app.parseRoute('#unknown/anything'), { view: 'p2', id: null });
  assert.deepEqual(app.parseRoute(''), { view: 'p2', id: null });
});

test('sanitizePreferences accepts only documented preference values', () => {
  assert.deepEqual(
    app.sanitizePreferences({
      answerMode: 'cues',
      fontSize: 'large',
      rate: 1.5,
      playbackMode: 'repeat',
    }),
    {
      answerMode: 'cues',
      fontSize: 'large',
      rate: 1.5,
      playbackMode: 'repeat',
    },
  );

  assert.deepEqual(
    app.sanitizePreferences({
      answerMode: 'hidden',
      fontSize: 'huge',
      rate: 3,
      playbackMode: 'shuffle',
    }),
    app.DEFAULT_PREFERENCES,
  );
});

test('createQueueSnapshot does not change when browsing filters later change', () => {
  const context = {
    query: 'decision',
    category: '人物',
    onlyUnlearned: true,
    selectedId: 'T001',
  };
  const queue = app.createQueueSnapshot('p2', collections.p2, context);

  context.query = 'changed';
  context.category = '地点';

  assert.deepEqual(queue.context, {
    view: 'p2',
    query: 'decision',
    category: '人物',
    onlyUnlearned: true,
    total: 1,
  });
  assert.equal(queue.items[0].id, 'T001');
});

test('stepQueueIndex preserves queue boundaries instead of wrapping', () => {
  assert.equal(app.stepQueueIndex(0, -1, 3), 0);
  assert.equal(app.stepQueueIndex(0, 1, 3), 1);
  assert.equal(app.stepQueueIndex(2, 1, 3), 2);
});

test('reconcileSelectedId never overrides explicit route or playback navigation', () => {
  const items = [{ id: 'T002' }];

  assert.equal(app.reconcileSelectedId({
    selectedId: 'T001',
    items,
    mobile: false,
    filterChanged: false,
  }), 'T001');
  assert.equal(app.reconcileSelectedId({
    selectedId: 'T001',
    items,
    mobile: false,
    filterChanged: true,
  }), 'T002');
  assert.equal(app.reconcileSelectedId({
    selectedId: 'T001',
    items,
    mobile: true,
    filterChanged: true,
  }), null);
});

test('next-question navigation cannot overwrite saved mobile list scroll', () => {
  assert.equal(app.nextListScrollTop({
    mobile: true,
    mobileScreen: 'reader',
    saved: 2200,
    current: 650,
  }), 2200);
  assert.equal(app.nextListScrollTop({
    mobile: true,
    mobileScreen: 'list',
    saved: 2200,
    current: 2350,
  }), 2350);
  assert.equal(app.nextListScrollTop({
    mobile: false,
    mobileScreen: 'reader',
    saved: 120,
    current: 180,
  }), 180);
});

test('classifyPlaybackFailure keeps media errors distinct from autoplay denial', () => {
  assert.equal(app.classifyPlaybackFailure('NotAllowedError'), 'autoplay');
  assert.equal(app.classifyPlaybackFailure('NotSupportedError'), 'media');
  assert.equal(app.classifyPlaybackFailure('NetworkError'), 'media');
  assert.equal(app.classifyPlaybackFailure('AbortError'), 'ignore');
});

test('validateProgressImport keeps valid boolean keys and counts ignored records', () => {
  const result = app.validateProgressImport(
    {
      version: 1,
      exportedAt: '2026-10-08T10:00:00.000Z',
      learned: {
        'p2:T001': true,
        'p1:P101': false,
        'p2:missing': true,
        'p2:T001:extra': true,
        'p1:P101-bad': 'yes',
      },
    },
    collections,
  );

  assert.deepEqual(result.valid, {
    'p2:T001': true,
    'p1:P101': false,
  });
  assert.equal(result.ignored, 3);
  assert.equal(result.error, null);
});

test('validateProgressImport rejects unsupported formats without partial writes', () => {
  assert.equal(app.validateProgressImport({ version: 9, learned: {} }, collections).error, '不支持的进度文件版本');
  assert.equal(app.validateProgressImport({ version: 1, learned: [] }, collections).error, '进度内容格式无效');
});
