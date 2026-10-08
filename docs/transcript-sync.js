(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TranscriptSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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

  function createTimeline(segments, duration, recording) {
    if (!Array.isArray(segments) || !segments.length || !Number.isFinite(duration) || duration <= 0
      || !Array.isArray(recording?.segments) || recording.segments.length !== segments.length
      || !Number.isFinite(recording.duration) || Math.abs(recording.duration - duration) > 0.15) return [];
    const valid = recording.segments.every((cue, index) =>
      cue.text === segments[index].text && Number.isFinite(cue.start) && Number.isFinite(cue.end)
      && cue.start >= 0 && cue.end > cue.start && cue.end <= recording.duration + 0.05
      && (index === 0 ? cue.start === 0 : Math.abs(cue.start - recording.segments[index - 1].end) < 0.001),
    );
    if (!valid || Math.abs(recording.segments.at(-1).end - recording.duration) > 0.05) return [];
    return segments.map((segment, index) => {
      const { start, end } = recording.segments[index];
      return { ...segment, start, end };
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
