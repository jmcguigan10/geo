import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WorldMap } from '../src/map.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.handlers = new Map();
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const value = force ?? !this.classes.has(name);
        if (value) this.classes.add(name); else this.classes.delete(name);
        return value;
      },
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.classes = new Set(String(value).split(/\s+/));
  }
  getAttribute(name) { return this.attributes.get(name); }
  append(...elements) {
    for (const element of elements) {
      if (element.tagName === '#fragment') this.children.push(...element.children);
      else this.children.push(element);
    }
  }
  addEventListener(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(handler);
  }
  dispatch(name, overrides = {}) {
    const event = { type: name, target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    for (const handler of this.handlers.get(name) ?? []) handler(event);
    return event;
  }
  closest(selector) { return selector === 'button' && this.tagName === 'button' ? this : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(id) { this.captured = id; }
}

function fixture({ emptyParent = false, detailUrl, detailFails = false, deferDetail = false } = {}) {
  const previous = new Map(['document', 'ResizeObserver', 'requestAnimationFrame', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = [];
  globalThis.document = { createElementNS: (_namespace, tag) => new Element(tag), createDocumentFragment: () => new Element('#fragment') };
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} };
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  const viewport = new Element();
  viewport.clientWidth = 900;
  viewport.clientHeight = 500;
  const svg = new Element('svg'), tooltip = new Element();
  viewport.querySelector = selector => selector === 'svg' ? svg : tooltip;
  const entities = [
    { id: 'country', name: 'Country', playable: true, d: 'M0 0H100V100H0Z M10 10V30H30V10Z', bbox: [0, 0, 100, 100] },
    { id: 'region', name: 'Region', parentId: 'country', playable: true, d: 'M10 10H30V30H10Z M15 15V20H20V15Z', bbox: [10, 10, 30, 30] },
    { id: 'district', name: 'District', parentId: 'region', playable: true, d: 'M15 15H20V20H15Z', bbox: [15, 15, 20, 20] },
    { id: 'dependency', name: 'Dependency', sovereign: 'Country', playable: true, d: 'M3000 500H3100V600H3000Z', bbox: [3000, 500, 3100, 600] },
    { id: 'island', name: 'Small island', playable: true, d: 'M1800 900H1800.01V900.01H1800Z', bbox: [1800, 900, 1800.01, 900.01] },
    { id: 'ocean', name: 'Not playable', playable: false, d: 'M0 0', bbox: [0, 0, 1, 1] },
  ];
  if (emptyParent) entities[0].d = '';
  const selected = [], levels = [], requests = [], detailStates = [];
  let resolveFetch;
  const detailData = { paths: { country: 'M0 0H100V100L50 90H0Z', island: 'M1800 900H1800.01V900.01L1800.005 900.015H1800Z' } };
  const detailResponse = { ok: !detailFails, json: async () => detailData };
  if (detailUrl) globalThis.fetch = url => {
    requests.push(String(url));
    return deferDetail ? new Promise(resolve => { resolveFetch = resolve; }) : Promise.resolve(detailResponse);
  };
  const map = new WorldMap(viewport, { width: 3600, height: 1800, entities }, { onSelect: id => selected.push(id), onZoom: level => levels.push(level), detailUrl, onDetail: state => detailStates.push(state) });
  const flush = () => { while (frames.length) frames.shift()(); };
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); flush(); };
  flush();
  return { map, viewport, svg, tooltip, selected, levels, flush, settle, requests, detailStates, detailData, releaseDetail: () => resolveFetch(detailResponse), dispose() { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } } };
}

function check(name, run, options) {
  test(name, async () => {
    const context = fixture(options);
    try { await run(context); } finally { context.dispose(); }
  });
}

check('country paths use nonzero fill so internal region cutouts retain holes', ({ map }) => {
  assert.equal(map.paths.size, 6);
  for (const path of map.paths.values()) assert.equal(path.getAttribute('fill-rule'), 'nonzero');
});

check('a missing country hides internal descendants and keeps overseas dependencies', ({ map }) => {
  map.setRound(['country']);
  for (const id of ['country', 'region', 'district']) assert.equal(map.paths.get(id).classList.contains('missing'), true, id);
  assert.equal(map.paths.get('dependency').classList.contains('missing'), false);
  map.setRound(['country'], ['country']);
  for (const path of map.paths.values()) assert.equal(path.classList.contains('missing'), false);
});

check('a missing internal region leaves the parent and independent sibling land visible', ({ map }) => {
  map.setRound(['region']);
  assert.equal(map.paths.get('region').classList.contains('missing'), true);
  assert.equal(map.paths.get('district').classList.contains('missing'), true);
  assert.equal(map.paths.get('country').classList.contains('missing'), false);
  assert.equal(map.paths.get('dependency').classList.contains('missing'), false);
});

check('round changes remove atlas highlights and only restore found answers', ({ map }) => {
  map.focusPlace('country');
  assert.equal(map.paths.get('region').classList.contains('selected'), true);
  map.setRound(['region', 'dependency'], ['dependency']);
  for (const path of map.paths.values()) assert.equal(path.classList.contains('selected'), false);
  assert.equal(map.paths.get('dependency').classList.contains('missing'), false);
  assert.equal(map.paths.get('region').classList.contains('missing'), true);
});

check('zoom stays within the world fit and 2048 times zoom while preserving its anchor', ({ map, flush }) => {
  const origin = [(350 - map.x) / map.scale, (220 - map.y) / map.scale];
  map.zoom(2, 350, 220);
  assert.ok(Math.abs((350 - map.x) / map.scale - origin[0]) < 1e-9);
  assert.ok(Math.abs((220 - map.y) / map.scale - origin[1]) < 1e-9);
  map.zoom(1e9); flush();
  assert.equal(map.scale / map.baseScale, 2048);
  map.zoom(1e-12); flush();
  assert.equal(map.scale / map.baseScale, 1);
});

check('small-island focus reaches a useful zoom and does not create markers', ({ map, flush }) => {
  map.focusPlace('island'); flush();
  assert.ok(map.scale / map.baseScale > 1000);
  assert.ok(map.scale / map.baseScale <= 2048);
  assert.equal(map.paths.get('island').classList.contains('selected'), true);
  assert.equal(map.group.children.filter(child => child.tagName === 'circle').length, 0);
});

check('resize preserves the place at the viewport center and relative zoom', ({ map, viewport, flush }) => {
  map.zoom(8); flush();
  const center = [(map.width / 2 - map.x) / map.scale, (map.height / 2 - map.y) / map.scale];
  const zoom = map.scale / map.baseScale;
  viewport.clientWidth = 700; viewport.clientHeight = 400;
  map.resize(); flush();
  assert.equal(map.scale / map.baseScale, zoom);
  assert.ok(Math.abs((map.width / 2 - map.x) / map.scale - center[0]) < 1e-9);
  assert.ok(Math.abs((map.height / 2 - map.y) / map.scale - center[1]) < 1e-9);
});

check('game mode never displays hovered country names or selects shapes', ({ map, viewport, tooltip, selected }) => {
  const target = map.paths.get('country');
  viewport.dispatch('pointermove', { target, clientX: 20, clientY: 30 });
  assert.equal(tooltip.hidden, true);
  viewport.dispatch('pointerdown', { target, clientX: 20, clientY: 30 });
  viewport.dispatch('pointerup', { target, clientX: 20, clientY: 30 });
  assert.deepEqual(selected, []);
});

check('atlas hover and tap identify visible playable places; drag does not select', ({ map, viewport, tooltip, selected, flush }) => {
  const target = map.paths.get('country');
  map.setExploring(true);
  viewport.dispatch('pointermove', { target, clientX: 20, clientY: 30 });
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, 'Country');
  viewport.dispatch('pointerdown', { target, clientX: 20, clientY: 30 });
  viewport.dispatch('pointerup', { target, clientX: 20, clientY: 30 });
  assert.deepEqual(selected, ['country']);
  map.zoom(2); flush();
  viewport.dispatch('pointerdown', { target, clientX: 20, clientY: 30 });
  viewport.dispatch('pointermove', { target, clientX: 60, clientY: 45 });
  viewport.dispatch('pointerup', { target, clientX: 60, clientY: 45 });
  assert.deepEqual(selected, ['country']);
  viewport.dispatch('pointermove', { target: map.paths.get('ocean') });
  assert.equal(tooltip.hidden, true);
});

check('pinching changes zoom and never selects a place after movement', ({ map, viewport, selected, flush }) => {
  map.setExploring(true);
  const target = map.paths.get('country');
  viewport.dispatch('pointerdown', { target, pointerId: 1, clientX: 300, clientY: 200 });
  viewport.dispatch('pointerdown', { target, pointerId: 2, clientX: 400, clientY: 200 });
  viewport.dispatch('pointermove', { target, pointerId: 2, clientX: 500, clientY: 200 });
  viewport.dispatch('pointerup', { target, pointerId: 2, clientX: 500, clientY: 200 });
  viewport.dispatch('pointerup', { target, pointerId: 1, clientX: 300, clientY: 200 });
  flush();
  assert.equal(map.scale / map.baseScale, 2);
  assert.deepEqual(selected, []);
});

check('keyboard navigation works only when focus is on the viewport', ({ map, viewport, flush }) => {
  viewport.dispatch('keydown', { key: '+' }); flush();
  assert.equal(map.scale / map.baseScale, 1.6);
  const x = map.x;
  const pan = viewport.dispatch('keydown', { key: 'ArrowRight' }); flush();
  assert.equal(pan.defaultPrevented, true);
  assert.equal(map.x, x - 80);
  viewport.dispatch('keydown', { key: '+', target: new Element('button') }); flush();
  assert.equal(map.scale / map.baseScale, 1.6);
  viewport.dispatch('keydown', { key: '0' }); flush();
  assert.equal(map.scale / map.baseScale, 1);
});

check('wheel navigation prevents page scrolling and supports line delta units', ({ map, viewport, flush }) => {
  const event = viewport.dispatch('wheel', { deltaY: -10, deltaMode: 1, clientX: 450, clientY: 250 }); flush();
  assert.equal(event.defaultPrevented, true);
  assert.ok(Math.abs(map.scale / map.baseScale - Math.exp(.64)) < 1e-9);
});

check('fully tiled countries can mask and select their children without a parent SVG path', ({ map }) => {
  assert.equal(map.paths.has('country'), false);
  map.setRound(['country']);
  assert.equal(map.paths.get('region').classList.contains('missing'), true);
  assert.equal(map.paths.get('district').classList.contains('missing'), true);
  map.setRound(['country'], ['country']);
  map.focusPlace('country');
  assert.equal(map.paths.get('region').classList.contains('missing'), false);
  assert.equal(map.paths.get('region').classList.contains('selected'), true);
}, { emptyParent: true });

check('a stationary two-finger gesture does not select a shape', ({ map, viewport, selected }) => {
  map.setExploring(true);
  viewport.dispatch('pointerdown', { target: map.paths.get('country'), pointerId: 1, clientX: 300, clientY: 200 });
  viewport.dispatch('pointerdown', { target: map.paths.get('region'), pointerId: 2, clientX: 400, clientY: 200 });
  viewport.dispatch('pointerup', { pointerId: 2, clientX: 400, clientY: 200 });
  viewport.dispatch('pointerup', { pointerId: 1, clientX: 300, clientY: 200 });
  assert.deepEqual(selected, []);
});

check('zoom culling hides offscreen shapes and returns every shape at the world view', ({ map, flush }) => {
  map.focusPlace('island'); flush();
  assert.equal(map.paths.get('island').classList.contains('culled'), false);
  assert.equal(map.paths.get('country').classList.contains('culled'), true);
  assert.equal(map.paths.get('dependency').classList.contains('culled'), true);
  map.setRound(['country']);
  map.fitWorld(); flush();
  for (const shape of map.paths.values()) assert.equal(shape.classList.contains('culled'), false);
  assert.equal(map.paths.get('country').classList.contains('missing'), true);
});

check('finer coastlines load only after deep zoom, preserve hidden states, and reuse the cached data', async ({ map, flush, settle, requests, detailStates, detailData }) => {
  assert.deepEqual(requests, []);
  const coarse = map.paths.get('country').getAttribute('d');
  map.zoom(8); flush();
  assert.deepEqual(requests, []);
  map.setRound(['country']);
  map.zoom(2); flush();
  assert.equal(requests.length, 1);
  assert.equal(map.detailStatus, 'loading');
  map.schedule(); flush();
  assert.equal(requests.length, 1);
  await settle();
  assert.equal(map.detailStatus, 'loaded');
  assert.equal(map.paths.get('country').getAttribute('d'), detailData.paths.country);
  assert.equal(map.paths.get('country').classList.contains('missing'), true);
  assert.equal(map.paths.get('region').classList.contains('missing'), true);
  assert.deepEqual(detailStates, ['loading', 'loaded']);
  map.fitWorld(); flush();
  assert.equal(map.paths.get('country').getAttribute('d'), coarse);
  map.zoom(16); flush();
  assert.equal(map.paths.get('country').getAttribute('d'), detailData.paths.country);
  assert.equal(requests.length, 1);
}, { detailUrl: './data/world-detail.json' });

check('detail arriving after zooming out keeps the world on the coarse resolution', async ({ map, flush, settle, releaseDetail, detailStates }) => {
  const coarse = map.paths.get('country').getAttribute('d');
  map.zoom(16); flush();
  map.fitWorld(); flush();
  releaseDetail(); await settle();
  assert.deepEqual(detailStates, ['loading', 'loaded']);
  assert.equal(map.detailShown, false);
  assert.equal(map.paths.get('country').getAttribute('d'), coarse);
}, { detailUrl: './data/world-detail.json', deferDetail: true });

check('failed optional detail keeps the game map available and avoids repeated background requests', async ({ map, flush, settle, requests, detailStates }) => {
  const coarse = map.paths.get('country').getAttribute('d');
  map.zoom(16); flush(); await settle();
  assert.equal(map.detailStatus, 'error');
  assert.deepEqual(detailStates, ['loading', 'error']);
  assert.equal(map.paths.get('country').getAttribute('d'), coarse);
  map.zoom(2); flush();
  assert.equal(requests.length, 1);
  map.setRound(['country']);
  assert.equal(map.paths.get('country').classList.contains('missing'), true);
}, { detailUrl: './data/world-detail.json', detailFails: true });

check('one compound land fill excludes a missing country and all of its internal children', ({ map, flush }) => {
  const wholeWorld = map.landBase.getAttribute('d');
  assert.equal(map.landBase.getAttribute('fill-rule'), 'nonzero');
  assert.equal(wholeWorld, [...map.paths.values()].map(shape => shape.getAttribute('d')).join(''));
  map.setRound(['country']); flush();
  const visible = ['dependency', 'island', 'ocean'].map(id => map.paths.get(id).getAttribute('d')).join('');
  assert.equal(map.landBase.getAttribute('d'), visible);
  for (const id of ['country', 'region', 'district']) {
    assert.equal(map.paths.get(id).classList.contains('missing'), true);
    assert.equal(map.paths.get(id).classList.contains('selected'), false);
  }
  map.setRound(['country'], ['country']); flush();
  assert.equal(map.landBase.getAttribute('d'), wholeWorld);
  map.setRound(); flush();
  assert.equal(map.landBase.getAttribute('d'), wholeWorld);
});

check('compound land fill preserves a parent cutout when only its internal region is missing', ({ map, flush }) => {
  map.setRound(['region']); flush();
  const visible = ['country', 'dependency', 'island', 'ocean'].map(id => map.paths.get(id).getAttribute('d')).join('');
  assert.equal(map.landBase.getAttribute('d'), visible);
  assert.equal(map.paths.get('country').classList.contains('missing'), false);
  assert.equal(map.paths.get('region').classList.contains('missing'), true);
  assert.equal(map.paths.get('district').classList.contains('missing'), true);
  assert.match(map.landBase.getAttribute('d'), /M10 10V30H30V10Z/);
});

check('culling also removes offscreen geometry from the compound land fill', ({ map, flush }) => {
  map.focusPlace('island'); flush();
  assert.equal(map.landBase.getAttribute('d'), map.paths.get('island').getAttribute('d'));
  map.setRound(['island']); flush();
  assert.equal(map.landBase.getAttribute('d'), '');
  map.setRound(); flush();
  assert.equal(map.landBase.getAttribute('d'), map.paths.get('island').getAttribute('d'));
});

test('styles keep individual hit paths transparent and missing land absent over the ocean background', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const countryRules = [...css.matchAll(/\.country-path\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.match(countryRules.at(-1), /fill:\s*transparent/);
  assert.match(css, /\.land-base\s*\{[^}]*fill:\s*var\(--land\)/);
  assert.match(css, /\.country-path\.missing\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.map-viewport\s*\{[^}]*background:\s*var\(--water\)/);
  assert.match(countryRules.join(';'), /stroke:\s*none/);
});
