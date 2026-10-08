const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitTranscript,
  createTimeline,
  findActiveSegment,
} = require('../docs/transcript-sync.js');

test('splitTranscript keeps sentence order and paragraph ownership', () => {
  const segments = splitTranscript([
    "I'd like to begin. It was useful!",
    'Would I do it again? Yes, definitely.',
  ]);

  assert.deepEqual(segments, [
    { text: "I'd like to begin.", paragraphIndex: 0 },
    { text: 'It was useful!', paragraphIndex: 0 },
    { text: 'Would I do it again?', paragraphIndex: 1 },
    { text: 'Yes, definitely.', paragraphIndex: 1 },
  ]);
});

test('createTimeline uses recorded audio boundaries even when word lengths suggest different timing', () => {
  const timeline = createTimeline([
    { text: 'One two.', paragraphIndex: 0 },
    { text: 'Three four five six.', paragraphIndex: 0 },
  ], 10, { duration: 10, segments: [
    { text: 'One two.', start: 0, end: 7.5 },
    { text: 'Three four five six.', start: 7.5, end: 10 },
  ] });

  assert.deepEqual(timeline, [
    { text: 'One two.', paragraphIndex: 0, start: 0, end: 7.5 },
    { text: 'Three four five six.', paragraphIndex: 0, start: 7.5, end: 10 },
  ]);
});

test('unverified, stale or invalid audio cues never produce estimated highlighting', () => {
  const segments = [{ text: 'Hello.', paragraphIndex: 0 }];
  const cues = { duration: 5, segments: [{ text: 'Hello.', start: 0, end: 5 }] };
  assert.deepEqual(createTimeline(segments, 5), []);
  assert.deepEqual(createTimeline(segments, 9, cues), []);
  assert.deepEqual(createTimeline(segments, 5, { ...cues, segments: [{ text: 'Changed.', start: 0, end: 5 }] }), []);
  assert.deepEqual(createTimeline(segments, 5, { ...cues, segments: [{ text: 'Hello.', start: 3, end: 2 }] }), []);
  assert.equal(findActiveSegment(createTimeline(segments, 5, cues), 4.99), 0);
});

test('findActiveSegment follows seeks and treats a boundary as the next sentence', () => {
  const timeline = [
    { start: 0, end: 4 },
    { start: 4, end: 10 },
  ];

  assert.equal(findActiveSegment(timeline, 0), 0);
  assert.equal(findActiveSegment(timeline, 3.99), 0);
  assert.equal(findActiveSegment(timeline, 4), 1);
  assert.equal(findActiveSegment(timeline, 9.5), 1);
  assert.equal(findActiveSegment(timeline, 10), 1);
});

test('empty or unavailable audio produces no active sentence', () => {
  assert.deepEqual(createTimeline([], 10), []);
  assert.deepEqual(createTimeline([{ text: 'Hello.', paragraphIndex: 0 }], 0), []);
  assert.equal(findActiveSegment([], 5), -1);
});
