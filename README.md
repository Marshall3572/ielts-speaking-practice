# IELTS Speaking Practice

Mobile-first static practice site for IELTS Speaking Part 1, Part 2, Part 3,
and reusable stories. It includes bilingual prompts, memorisation mode,
device-local learned progress, and 172 synthesized British English audio files
(macOS Daniel, 160 words per minute).

Only the public static site is included. Practice experiences are examples,
and this is not an official IELTS question bank or a score guarantee.

## Local preview and checks

```bash
python3 -m http.server 8774 --directory docs
node --test test/*.test.js
```

Open `http://127.0.0.1:8774/#p2`. Test old deep links such as
`#p2/T001`, `#p1/P101`, `#p3/P301`, and `#stories/M01`.

## Browser state

- Learned progress remains in `ielts-speaking-progress-v2` as boolean
  `view:id` entries.
- UI preferences use `ielts-speaking-ui-v1` for answer mode, text size,
  playback speed, and playback mode.
- The last opened item uses `ielts-speaking-last-item-v1`.
- Search/filter/scroll contexts are session-only. Audio queues are not restored
  after refresh and the site never autoplays on page load.

GitHub Pages serves the `docs/` directory. All runtime asset references are
relative so the site works below `/ielts-speaking-practice/`.
