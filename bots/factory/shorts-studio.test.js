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

test('vertical 9:16 output with centered original aspect ratio', () => {
  const filter = filterGraph('/tmp/factory-shorts-test');
  assert.match(filter, /scale=720:760:force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=720:1280/);
  assert.match(filter, /fontcolor=white/);
  assert.match(filter, /fontcolor=yellow/);
  assert.match(filter, /top\.txt/);
  assert.match(filter, /bottom\.txt/);
});

test('FFmpeg uses efficient default encoding and retains original audio', () => {
  const a = ffmpegArgs({ input: '/tmp/in.mp4', output: '/tmp/out.mp4', directory: '/tmp/test', start: 7, seconds: 30 });
  assert.equal(a[a.indexOf('-ss') + 1], '7');
  assert.equal(a[a.indexOf('-t') + 1], '30');
  assert.equal(a[a.indexOf('-preset') + 1], 'veryfast');
  assert.ok(a.includes('0:a:0?'));
  assert.ok(a.includes('libx264'));
  assert.ok(a.includes('aac'));
});

test('input size stays under Telegram cloud bot downloading limit', () => {
  assert.ok(INPUT_LIMIT < 20 * 1024 * 1024);
});
