'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { escapeXml, overlaySvg, createOverlayPng } = require('./shorts-overlay');

test('SVG contains actual bot username and code with XML escaping', () => {
  const svg = overlaySvg('y808bot', '769', 'KINO');
  assert.match(svg, /@y808bot/);
  assert.match(svg, /KINO KODI: 769/);
  assert.match(svg, /width="720" height="1280"/);
  assert.doesNotMatch(svg, /drawtext/);
  assert.equal(escapeXml('<bad&value>'), '&lt;bad&amp;value&gt;');
});

test('Sharp creates a PNG with valid 9:16 transparent canvas', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'factory-shorts-overlay-test-'));
  try {
    const output = await createOverlayPng({ directory: dir, username: 'y808bot', code: '769', label: 'KINO' });
    const m = await sharp(output).metadata();
    assert.equal(m.width, 540);
    assert.equal(m.height, 960);
    assert.equal(m.format, 'png');
    assert.equal(m.hasAlpha, true);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
