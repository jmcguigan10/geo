import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A small DOM harness exercises the real app and map modules without adding a
// browser/runtime dependency. It models the DOM operations used by this site;
// layout and SVG rasterization still need visual checks in a real browser.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.handlers = new Map();
    this.classes = new Set();
    this.value = '';
    this.hidden = false;
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
  set className(value) { this.classes = new Set(String(value).split(/\s+/)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text ?? this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = value;
  }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  detach() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
  insert(elements, prepend = false) {
    this._text = undefined;
    const flattened = elements.flatMap(element => element.tagName === '#fragment' ? [...element.children] : [element]);
    for (const element of flattened) { element.detach(); element.parentElement = this; }
    if (prepend) this.children.unshift(...flattened); else this.children.push(...flattened);
  }
  append(...elements) { this.insert(elements); }
  prepend(...elements) { this.insert(elements, true); }
  replaceChildren(...elements) {
    for (const child of this.children) child.parentElement = null;
    this.children = []; this._text = undefined; this.append(...elements);
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
  getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 500 }; }
  setPointerCapture() {}
  focus() { this.focused = true; }
  select() { this.selectedText = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

let instance = 0;
async function fixture({ mobile = false, failFetch = false, savedPreferences = null } = {}) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1]);
    element.id = match[3];
    element.hidden = /\bhidden\b/.test(match[2]);
    element.disabled = /\bdisabled\b/.test(match[2]);
    const classes = /\bclass="([^"]+)"/.exec(match[2]);
    if (classes) element.className = classes[1];
    elements.set(element.id, element);
  }
  const regions = [...html.matchAll(/<button\b([^>]*\bdata-region="([^"]+)"[^>]*)>/g)].map(match => {
    const element = new Element('button'); element.dataset.region = match[2]; return element;
  });
  const $ = id => {
    assert.ok(elements.has(id), `Markup contains #${id}`);
    return elements.get(id);
  };
  $('pool').value = 'all'; $('duration').value = '600';
  $('playing-controls').append($('guess-form'), $('answer-feedback'));
  $('guess-form').append($('answer'));
  $('map-viewport').clientWidth = mobile ? 354 : 900;
  $('map-viewport').clientHeight = mobile ? 350 : 500;
  $('map-viewport').querySelector = selector => selector === 'svg' ? $('world-map') : $('map-tooltip');
  const document = new Element('#document');
  document.getElementById = $;
  document.querySelectorAll = selector => selector === '.region' ? regions : [];
  const mapCard = new Element('section');
  mapCard.requestFullscreen = async () => { document.fullscreenElement = mapCard; document.dispatch('fullscreenchange'); };
  document.exitFullscreen = async () => { document.fullscreenElement = null; document.dispatch('fullscreenchange'); };
  document.querySelector = selector => selector === '.map-card' ? mapCard : null;
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.createDocumentFragment = () => new Element('#fragment');
  document.createTextNode = value => { const element = new Element('#text'); element.textContent = value; return element; };
  const layout = new Element(); layout.matches = mobile;
  const entities = [
    { id: 'esp', name: 'Spain', kind: 'country', continent: 'Europe' },
    { id: 'cat', name: 'Catalonia', kind: 'territory', subtype: 'Autonomous community', continent: 'Europe', parentId: 'esp' },
    { id: 'gin', name: 'Guinea', kind: 'country', continent: 'Africa' },
    { id: 'gnb', name: 'Guinea-Bissau', kind: 'country', continent: 'Africa' },
    ...Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, name: `Place ${i}`, kind: 'country', aliases: [`P${i}`], continent: 'Asia' })),
    { id: 'hkg', name: 'Hong Kong', kind: 'territory', continent: 'Asia', sovereign: 'China', aliases: ['Hong Kong SAR'] },
    { id: 'ata', name: 'Antarctica', kind: 'territory', playable: false, continent: 'Antarctica' },
  ].map((place, i) => ({ playable: true, d: `M${i * 100} 400h80v80h-80Z`, bbox: [i * 100, 400, i * 100 + 80, 480], ...place }));
  const world = { width: 3600, height: 1800, entities };
  const frames = [], intervals = [], timeouts = new Map(), requests = [], saved = new Map();
  let timeoutId = 0, timestamp = 1000, fetchFails = failFetch;
  const previous = new Map(['document', 'window', 'ResizeObserver', 'requestAnimationFrame', 'setInterval', 'setTimeout', 'clearTimeout', 'fetch', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalRandom = Math.random, originalNow = Date.now;
  const localStorage = { getItem: () => savedPreferences, setItem: (key, value) => saved.set(key, value) };
  const globals = {
    document, window: { matchMedia: () => layout }, localStorage,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    setInterval: callback => { intervals.push(callback); return intervals.length; },
    setTimeout: callback => { timeouts.set(++timeoutId, callback); return timeoutId; },
    clearTimeout: id => timeouts.delete(id),
    fetch: async url => { requests.push(String(url)); return { ok: !fetchFails, status: fetchFails ? 404 : 200, json: async () => String(url).endsWith('/world-detail.json') ? { paths: Object.fromEntries(entities.map(place => [place.id, place.d])) } : world }; },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  Math.random = () => 0; Date.now = () => timestamp;
  const flush = () => { while (frames.length) frames.shift()(); };
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); flush(); };
  await import(`../src/app.js?ui-test=${++instance}`);
  await settle();
  const allShapes = () => $('world-map').children[0].children.filter(child => child.tagName === 'path');
  return {
    $, document, layout, entities, requests, saved, flush, settle,
    shape: id => allShapes().find(shape => shape.dataset.id === id),
    hiddenIds: () => allShapes().filter(shape => shape.classList.contains('missing')).map(shape => shape.dataset.id),
    input: value => { $('answer').value = value; $('answer').dispatch('input'); for (const [id, callback] of [...timeouts]) { timeouts.delete(id); callback(); } flush(); },
    submit: value => { $('answer').value = value; $('guess-form').dispatch('submit'); flush(); },
    tick: milliseconds => { timestamp += milliseconds; for (const callback of intervals) callback(); flush(); },
    allowFetch: () => { fetchFails = false; },
    dispose: () => {
      Math.random = originalRandom; Date.now = originalNow;
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

function check(name, run, options) {
  test(name, async () => {
    const context = await fixture(options);
    try { await run(context); } finally { context.dispose(); }
  });
}

check('map load enables play, counts the pool, and requests a relative static data file', ({ $, requests }) => {
  assert.equal($('start').disabled, false);
  assert.equal($('map-loading').hidden, true);
  assert.equal($('coverage-count').textContent, '27');
  assert.equal($('pool-note').textContent, '27 places in the pool. All 20 chosen at random.');
  assert.ok(requests[0].endsWith('/data/world.json'));
});

check('starting a round masks exactly 20 answers and blocks both atlas entry points', ({ $, hiddenIds, shape }) => {
  $('start').dispatch('click');
  const hidden = hiddenIds();
  assert.equal(hidden.length, 21); // 20 answers plus Catalonia inside missing Spain.
  assert.equal(shape('esp').classList.contains('missing'), true);
  assert.equal(shape('cat').classList.contains('missing'), true);
  assert.equal($('playing-controls').hidden, false);
  assert.equal($('nav-explore').disabled, true);
  assert.equal($('about-explore').disabled, true);
  $('nav-explore').dispatch('click'); $('about-explore').dispatch('click');
  assert.equal($('explore-panel').hidden, true);
  assert.equal($('game-panel').hidden, false);
  assert.deepEqual(hiddenIds(), hidden);
  $('nav-play').dispatch('click');
  assert.deepEqual(hiddenIds(), hidden);
});

check('prefix answers wait for Enter when a longer missing name could still be typed', ({ $, input, submit, shape }) => {
  $('start').dispatch('click');
  input('Guinea');
  assert.equal($('score').textContent, '0');
  assert.match($('answer-feedback').textContent, /Press Enter/);
  assert.equal(shape('gin').classList.contains('missing'), true);
  submit('Guinea');
  assert.equal($('score').textContent, '1');
  assert.equal(shape('gin').classList.contains('missing'), false);
  assert.equal(shape('gnb').classList.contains('missing'), true);
  input('Guinea Bissau');
  assert.equal($('score').textContent, '2');
});

check('aliases, duplicates, not-missing names, and unknown answers produce correct feedback', ({ $, submit }) => {
  $('start').dispatch('click');
  submit('P0');
  assert.equal($('score').textContent, '1');
  assert.equal($('answer').value, '');
  submit('Place 0');
  assert.match($('answer-feedback').textContent, /already found Place 0/);
  assert.equal($('score').textContent, '1');
  submit('Hong Kong SAR');
  assert.match($('answer-feedback').textContent, /already on the map/);
  submit('Nonsense');
  assert.match($('answer-feedback').textContent, /wasn’t recognized/);
});

check('give-up reveals answers, enables exploration, and reset clears the old result', ({ $, hiddenIds, shape }) => {
  $('start').dispatch('click'); $('give-up').dispatch('click');
  assert.equal($('playing-controls').hidden, true);
  assert.equal($('results-controls').hidden, false);
  assert.equal($('result-list').children.length, 20);
  assert.equal($('nav-explore').disabled, false);
  assert.deepEqual(hiddenIds(), []);
  const answer = $('result-list').children.find(item => item.children[1].textContent === 'Spain').children[1];
  answer.dispatch('click');
  assert.equal($('map-heading').textContent, 'SPAIN');
  assert.equal(shape('esp').classList.contains('selected'), true);
  assert.equal(shape('cat').classList.contains('selected'), true);
  $('play-again').dispatch('click');
  assert.equal($('setup-controls').hidden, false);
  assert.equal($('results-controls').hidden, true);
  assert.equal($('score').textContent, '0');
  assert.equal(shape('esp').classList.contains('selected'), false);
});

check('timer expiration reveals the map and prevents guesses at the deadline', ({ $, tick, submit, hiddenIds }) => {
  $('duration').value = '210'; $('start').dispatch('click');
  tick(210000);
  assert.equal($('timer').textContent, '0:00');
  assert.equal($('results-controls').hidden, false);
  assert.match($('result-title').textContent, /Time to meet the missing/);
  submit('Spain');
  assert.equal($('score').textContent, '0');
  assert.deepEqual(hiddenIds(), []);
});

check('untimed rounds remain active and accept the last correct answer as a win', ({ $, entities, hiddenIds, submit, tick }) => {
  $('duration').value = 'null'; $('start').dispatch('click'); tick(1e9);
  assert.equal($('timer').textContent, '∞');
  assert.equal($('playing-controls').hidden, false);
  for (const id of hiddenIds().filter(id => id !== 'cat')) submit(entities.find(place => place.id === id).name);
  assert.equal($('score').textContent, '20');
  assert.match($('result-title').textContent, /world is whole again/);
  assert.equal($('result-count').textContent, '20/20');
});

check('atlas searches names, aliases, and regions and shows internal regions with their parent', ({ $, shape }) => {
  $('nav-explore').dispatch('click');
  assert.equal($('explore-panel').hidden, false);
  $('place-search').value = 'Hong Kong SAR'; $('place-search').dispatch('input');
  assert.equal($('search-count').textContent, '1 place found');
  $('place-list').children[0].children[0].dispatch('click');
  assert.equal($('map-heading').textContent, 'HONG KONG');
  assert.match($('place-detail').textContent, /China/);
  assert.equal(shape('hkg').classList.contains('selected'), true);
  $('place-search').value = 'Europe'; $('place-search').dispatch('input');
  assert.equal($('search-count').textContent, '2 places found');
  const region = $('place-list').children.find(item => item.children[0].children[0].textContent === 'Catalonia');
  region.children[0].dispatch('click');
  assert.match($('place-detail').textContent, /Autonomous community/);
  assert.match($('place-detail').textContent, /Spain/);
  assert.equal(shape('cat').classList.contains('selected'), true);
  assert.equal(shape('esp').classList.contains('selected'), false);
});

check('mobile play keeps the live form below the map and restores it after the round', ({ $, submit }) => {
  $('start').dispatch('click');
  assert.equal($('mobile-guess-dock').hidden, false);
  assert.equal($('guess-form').parentElement, $('mobile-guess-dock'));
  assert.equal($('answer-feedback').parentElement, $('mobile-guess-dock'));
  assert.equal($('map-viewport').classList.contains('mobile-playing'), true);
  assert.equal($('mobile-guess-dock').scrolledIntoView, true);
  submit('Spain');
  assert.equal($('mobile-round-score').textContent, '1 / 20 found');
  $('give-up').dispatch('click');
  assert.equal($('mobile-guess-dock').hidden, true);
  assert.equal($('guess-form').parentElement, $('playing-controls'));
  assert.equal($('answer-feedback').parentElement, $('playing-controls'));
}, { mobile: true });

check('resizing during play moves the existing form without resetting its answer or listeners', ({ $, layout, submit }) => {
  $('start').dispatch('click');
  $('answer').value = 'Partial answer';
  layout.matches = true; layout.dispatch('change');
  assert.equal($('guess-form').parentElement, $('mobile-guess-dock'));
  assert.equal($('answer').value, 'Partial answer');
  submit('Spain');
  assert.equal($('score').textContent, '1');
  layout.matches = false; layout.dispatch('change');
  assert.equal($('guess-form').parentElement, $('playing-controls'));
  assert.equal($('mobile-guess-dock').hidden, true);
  submit('Guinea');
  assert.equal($('score').textContent, '2');
});

check('desktop fullscreen retains the answer form and restores it to the sidebar on exit', async ({ $, document, settle, submit }) => {
  $('start').dispatch('click');
  $('answer').value = 'Partial answer';
  $('fullscreen').dispatch('click'); await settle();
  assert.ok(document.fullscreenElement);
  assert.equal($('fullscreen').getAttribute('aria-label'), 'Exit expanded map');
  assert.equal($('mobile-guess-dock').hidden, false);
  assert.equal($('guess-form').parentElement, $('mobile-guess-dock'));
  assert.equal($('answer').value, 'Partial answer');
  submit('Spain');
  assert.equal($('mobile-round-score').textContent, '1 / 20 found');
  $('fullscreen').dispatch('click'); await settle();
  assert.equal(document.fullscreenElement, null);
  assert.equal($('guess-form').parentElement, $('playing-controls'));
  assert.equal($('mobile-guess-dock').hidden, true);
  assert.equal($('fullscreen').getAttribute('aria-label'), 'Expand map');
  submit('Guinea');
  assert.equal($('score').textContent, '2');
});

check('finishing a fullscreen round exits expansion and restores the form before results', async ({ $, document, settle }) => {
  $('start').dispatch('click'); $('fullscreen').dispatch('click'); await settle();
  $('give-up').dispatch('click'); await settle();
  assert.equal(document.fullscreenElement, null);
  assert.equal($('guess-form').parentElement, $('playing-controls'));
  assert.equal($('mobile-guess-dock').hidden, true);
  assert.equal($('results-controls').hidden, false);
});

check('saved preferences restore only supported settings and country pool omits territories', ({ $, saved }) => {
  assert.equal($('pool').value, 'countries');
  assert.equal($('duration').value, 'null');
  assert.equal($('timer').textContent, '∞');
  assert.equal($('pool-note').textContent, '25 places in the pool. All 20 chosen at random.');
  const preferences = JSON.parse(saved.get('meridian-preferences'));
  assert.deepEqual(preferences, { pool: 'countries', duration: 'null' });
}, { savedPreferences: JSON.stringify({ pool: 'countries', duration: 'null' }) });

test('a failed data request exposes a working retry and does not enable play prematurely', async () => {
  const originalError = console.error;
  console.error = () => {};
  let context;
  try {
    context = await fixture({ failFetch: true });
    assert.equal(context.$('start').disabled, true);
    assert.match(context.$('map-loading').textContent, /couldn’t load/);
    context.allowFetch(); context.$('map-loading').children[1].dispatch('click');
    await context.settle();
    assert.equal(context.$('start').disabled, false);
    assert.equal(context.$('map-loading').hidden, true);
    assert.equal(context.requests.length, 2);
  } finally {
    context?.dispose(); console.error = originalError;
  }
});
