'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseSegment, safeCode, safeUsername, filterGraph, ffmpegArgs, INPUT_LIMIT, EDIT_SECONDS } = require('./shorts-studio');

test('30-second video is not cut and long video gets a clip', () => {
  assert.deepEqual(chooseSegment(15, 30), { start: 0, seconds: 30 });
  assert.deepEqual(chooseSegment(80, 30, () => 0), { start: 0, seconds: 30 });
  assert.deepEqual(chooseSegment(80, 30, () => 0.9), { start: 45, seconds: 30 });
  assert.deepEqual(chooseSegment(30, 30), { start: 0, seconds: 30 });
  assert.equal(EDIT_SECONDS, 30);
});

test('only valid codes and telegram usernames are used in overlays', () => {
  assert.equal(safeCode('769'), '769');
  assert.equal(safeCode('abc_2026'), 'abc_2026');
  assert.equal(safeCode('bad:drawtext=1'), '');
  assert.equal(safeCode('../secret'), '');
  assert.equal(safeUsername('@y808bot'), 'y808bot');
  assert.equal(safeUsername('@Multik_2026bot'), 'Multik_2026bot');
  assert.equal(safeUsername('!!'), '');
});

test('vertical 9:16 output uses PNG overlay rather than drawtext', () => {
  const filter = filterGraph();
  assert.match(filter, /scale=720:760:force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=720:1280/);
  assert.match(filter, /overlay=0:0:shortest=1/);
  assert.doesNotMatch(filter, /drawtext/);
});

test('FFmpeg uses independent overlay image and original soundtrack', () => {
  const a = ffmpegArgs({ input: '/tmp/in.mp4', overlay: '/tmp/overlay.png', output: '/tmp/out.mp4', start: 7, seconds: 30 });
  assert.equal(a[a.indexOf('-ss') + 1], '7');
  assert.equal(a[a.indexOf('-t') + 1], '30');
  assert.equal(a[a.indexOf('-preset') + 1], 'veryfast');
  assert.equal(a[a.indexOf('-filter_complex') + 1], filterGraph());
  assert.ok(a.includes('/tmp/overlay.png'));
  assert.ok(a.includes('[v]'));
  assert.ok(a.includes('0:a:0?'));
  assert.ok(a.includes('libx264'));
  assert.ok(a.includes('aac'));
});

test('input size stays under Telegram cloud bot downloading limit', () => {
  assert.ok(INPUT_LIMIT < 20 * 1024 * 1024);
});
