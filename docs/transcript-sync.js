(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TranscriptSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const wordPattern = /\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g;

  function sentenceTexts(text) {
    const value = String(text ?? '').trim();
    if (!value) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      return Array.from(segmenter.segment(value), part => part.segment.trim()).filter(Boolean);
    }
    return value.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(part => part.trim()).filter(Boolean) || [value];
  }

  function splitTranscript(paragraphs) {
    const values = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
    return values.flatMap((paragraph, paragraphIndex) =>
      sentenceTexts(paragraph).map(text => ({ text, paragraphIndex })),
    );
  }

  function createTimeline(segments, duration) {
    if (!Array.isArray(segments) || !segments.length || !Number.isFinite(duration) || duration <= 0) return [];
    const weights = segments.map(segment => {
      const words = String(segment.text ?? '').match(wordPattern)?.length || 1;
      return words + 2;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = 0;
    return segments.map((segment, index) => {
      const start = elapsed;
      elapsed = index === segments.length - 1 ? duration : elapsed + duration * weights[index] / totalWeight;
      return { ...segment, start, end: elapsed };
    });
  }

  function findActiveSegment(timeline, currentTime) {
    if (!Array.isArray(timeline) || !timeline.length || !Number.isFinite(currentTime)) return -1;
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      if (currentTime >= timeline[index].start) return index;
    }
    return 0;
  }

  return { splitTranscript, createTimeline, findActiveSegment };
});
