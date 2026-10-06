import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerIndex, createGame, normalizeAnswer, selectMissing } from '../src/game.js';

const places = [
  { id: 'usa', name: 'United States', kind: 'country', aliases: ['USA', 'U.S.', 'United States of America'] },
  { id: 'civ', name: "Côte d’Ivoire", kind: 'country', aliases: ['Ivory Coast'] },
  { id: 'stp', name: 'São Tomé and Príncipe', kind: 'country', aliases: ['Sao Tome & Principe'] },
  { id: 'chn', name: 'China', kind: 'country', aliases: ['PRC'] },
  { id: 'hkg', name: 'Hong Kong', kind: 'territory', aliases: ['Hong Kong SAR', 'China'] },
  { id: 'mac', name: 'Macao', kind: 'territory', aliases: ['Macau'] },
  { id: 'grl', name: 'Greenland', kind: 'territory', aliases: ['Kalaallit Nunaat'] },
  { id: 'cog', name: 'Republic of the Congo', kind: 'country', aliases: ['Congo', 'Congo-Brazzaville'] },
  { id: 'cod', name: 'Democratic Republic of the Congo', kind: 'country', aliases: ['Congo', 'DR Congo', 'DRC'] },
  { id: 'kor', name: 'South Korea', kind: 'country', aliases: ['Korea', 'Republic of Korea'] },
  { id: 'prk', name: 'North Korea', kind: 'country', aliases: ['Korea', 'DPRK'] },
  { id: 'ata', name: 'Antarctica', kind: 'territory', playable: false },
];

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('normalization ignores case, accents, whitespace, and punctuation, without fuzzy spelling', () => {
  assert.equal(normalizeAnswer('  CÔTE D\'IVOIRE! '), normalizeAnswer('Côte d’Ivoire'));
  assert.equal(normalizeAnswer('SÃO TOMÉ & PRÍNCIPE'), normalizeAnswer('São Tomé and Príncipe'));
  assert.equal(normalizeAnswer('U.S.A.'), 'usa');
  assert.notEqual(normalizeAnswer('United Statse'), normalizeAnswer('United States'));
});

test('known aliases resolve while ambiguous short names remain rejected', () => {
  const index = buildAnswerIndex(places);
  assert.equal(index.get(normalizeAnswer('ivory coast')), 'civ');
  assert.equal(index.get(normalizeAnswer('DR Congo')), 'cod');
  assert.equal(index.get(normalizeAnswer('Macau')), 'mac');
  assert.equal(index.has(normalizeAnswer('Congo')), false);
  assert.equal(index.has(normalizeAnswer('Korea')), false);
  // Even a filtered or incomplete source should not make these broad answers valid.
  assert.equal(buildAnswerIndex([places[7]]).has('congo'), false);
});

test('canonical sovereign names cannot accidentally match distinct territories', () => {
  const index = buildAnswerIndex(places);
  assert.equal(index.get('china'), 'chn');
  const game = createGame(places, { count: 20, duration: null, rng: () => 0 });
  game.start();
  assert.equal(game.guess('China').id, 'chn');
  assert.equal(game.state.foundIds.includes('hkg'), false);
  assert.equal(game.guess('Hong Kong SAR').id, 'hkg');
});

test('other ambiguous aliases are rejected independently of input order', () => {
  const input = [
    { id: 'a', name: 'Alpha', aliases: ['Shared'] },
    { id: 'b', name: 'Beta', aliases: ['Shared'] },
  ];
  assert.equal(buildAnswerIndex(input).has('shared'), false);
  assert.equal(buildAnswerIndex(input.toReversed()).has('shared'), false);
});

test('selection produces 20 distinct playable places without modifying the input', () => {
  const input = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Place ${i}` }));
  input.push({ id: 'off', name: 'Excluded', playable: false });
  input.push(input[0]);
  const original = [...input];
  const result = selectMissing(input, 20, seededRandom(42));
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map(({ id }) => id)).size, 20);
  assert.equal(result.some(({ id }) => id === 'off'), false);
  assert.deepEqual(input, original);
  assert.notDeepEqual(result, selectMissing(input, 20, seededRandom(43)));
});

test('selection limits small pools and rejects malformed counts and random sources', () => {
  assert.equal(selectMissing(places, 20, () => 0).length, 11);
  assert.throws(() => selectMissing(places, 0), RangeError);
  assert.throws(() => selectMissing(places, 1, () => 1), RangeError);
  assert.throws(() => selectMissing(places, 1, () => NaN), RangeError);
});

test('game distinguishes correct, duplicate, not-missing, and unknown guesses', () => {
  const game = createGame(places, { count: 2, duration: null, rng: () => 0 });
  assert.equal(game.guess('USA').status, 'inactive');
  game.start();
  assert.equal(game.guess('USA').status, 'correct');
  assert.equal(game.guess('United States of America').status, 'duplicate');
  assert.equal(game.guess('Greenland').status, 'not-missing');
  assert.equal(game.guess('United Statse').status, 'unknown');
  assert.equal(game.guess('Congo').status, 'unknown');
  assert.deepEqual(game.state.foundIds, ['usa']);
});

test('finding the last missing place ends the round and preserves its answers', () => {
  let timestamp = 1000;
  const game = createGame(places, { count: 2, duration: 600, rng: () => 0, now: () => timestamp });
  game.start();
  game.guess('USA');
  timestamp = 6000;
  const result = game.guess('Ivory Coast');
  assert.equal(result.status, 'correct');
  assert.equal(result.state.phase, 'ended');
  assert.equal(result.state.endReason, 'won');
  assert.equal(result.state.endedAt, 6000);
  assert.deepEqual(result.state.foundIds, ['usa', 'civ']);
  timestamp = 700000;
  game.tick();
  assert.equal(game.state.endReason, 'won');
  assert.deepEqual(game.state.missingIds, ['usa', 'civ']);
});

test('timer uses elapsed wall time and refuses a guess at the deadline', () => {
  let timestamp = 5000;
  const game = createGame(places, { count: 2, duration: 10, rng: () => 0, now: () => timestamp });
  game.start();
  timestamp += 4001;
  assert.equal(game.tick().remainingSeconds, 6);
  timestamp = 15000;
  const result = game.guess('USA');
  assert.equal(result.status, 'inactive');
  assert.equal(result.state.phase, 'ended');
  assert.equal(result.state.endReason, 'timeout');
  assert.equal(result.state.remainingSeconds, 0);
  assert.deepEqual(result.state.foundIds, []);
});

test('untimed rounds never expire; giving up preserves found and missing places', () => {
  let timestamp = 0;
  const game = createGame(places, { count: 2, duration: null, rng: () => 0, now: () => timestamp });
  game.start();
  game.guess('USA');
  timestamp = 10 ** 12;
  assert.equal(game.tick().phase, 'playing');
  assert.equal(game.state.remainingSeconds, null);
  const ended = game.end();
  assert.equal(ended.endReason, 'gave-up');
  assert.deepEqual(ended.foundIds, ['usa']);
  assert.deepEqual(ended.missingIds, ['usa', 'civ']);
});

test('country pool excludes territories while the all pool includes them', () => {
  const countries = createGame(places, { count: 20, pool: 'countries', duration: null, rng: () => 0 });
  const all = createGame(places, { count: 20, pool: 'all', duration: null, rng: () => 0 });
  const countryState = countries.start();
  assert.equal(countryState.count, 8);
  assert.equal(countryState.missingIds.includes('hkg'), false);
  assert.equal(countryState.missingIds.includes('ata'), false);
  assert.equal(countries.guess('Hong Kong').status, 'not-missing');
  assert.equal(all.start().missingIds.includes('hkg'), true);
  assert.equal(all.state.missingIds.includes('ata'), false);
});

test('restart resets answers and the clock, and draws a new random set', () => {
  let timestamp = 100;
  const game = createGame(places, { count: 2, duration: 600, rng: seededRandom(42), now: () => timestamp });
  const first = game.start();
  game.guess(places.find(({ id }) => id === first.missingIds[0]).name);
  game.end();
  timestamp = 10000;
  const second = game.start();
  assert.equal(second.phase, 'playing');
  assert.deepEqual(second.foundIds, []);
  assert.equal(second.endReason, null);
  assert.equal(second.startedAt, 10000);
  assert.equal(second.remainingSeconds, 600);
  assert.notDeepEqual(second.missingIds, first.missingIds);
});

test('state snapshots cannot mutate the running round', () => {
  const game = createGame(places, { count: 2, duration: null, rng: () => 0 });
  const state = game.start();
  state.missingIds.length = 0;
  state.foundIds.push('civ');
  assert.deepEqual(game.state.missingIds, ['usa', 'civ']);
  assert.deepEqual(game.state.foundIds, []);
});

test('invalid game configurations fail early', () => {
  assert.throws(() => createGame(places, { duration: -1 }), RangeError);
  assert.throws(() => createGame(places, { pool: 'other' }), RangeError);
  assert.throws(() => createGame([], {}), RangeError);
  assert.throws(() => createGame([places[0], places[0]]), TypeError);
});

const hierarchicalPlaces = [
  { id: 'esp', name: 'Spain', kind: 'country' },
  { id: 'cat', name: 'Catalonia', kind: 'autonomous-region', parentId: 'esp' },
  { id: 'gal', name: 'Galicia', kind: 'autonomous-region', parentId: 'esp' },
  { id: 'prt', name: 'Portugal', kind: 'country' },
  { id: 'aze', name: 'Azores', kind: 'autonomous-region', parentId: 'prt' },
  { id: 'mdr', name: 'Madeira', kind: 'autonomous-region', parentId: 'prt' },
  { id: 'grl', name: 'Greenland', kind: 'territory' },
  { id: 'dnk', name: 'Denmark', kind: 'country' },
];

test('hierarchy selection never hides an internal region and its parent together', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const selected = selectMissing(hierarchicalPlaces, 4, seededRandom(seed));
    const ids = new Set(selected.map(({ id }) => id));
    assert.equal(selected.length, 4);
    for (const place of selected) {
      assert.equal(ids.has(place.parentId), false, `Parent conflict for ${place.id}`);
    }
  }
});

test('a shuffled greedy dead end recovers a compatible set when one exists', () => {
  const selected = selectMissing(hierarchicalPlaces.slice(0, 3), 2, () => 0);
  assert.deepEqual(selected.map(({ id }) => id), ['cat', 'gal']);
  assert.throws(() => selectMissing(hierarchicalPlaces.slice(0, 3), 3, () => 0), /only 2/);
});

test('hierarchy conflicts include ancestors through unplayable intermediate regions', () => {
  const input = [
    { id: 'a', name: 'Country' },
    { id: 'b', name: 'Intermediate', parentId: 'a', playable: false },
    { id: 'c', name: 'Internal area', parentId: 'b' },
    { id: 'd', name: 'Other' },
  ];
  const selected = selectMissing(input, 2, () => 0);
  const ids = selected.map(({ id }) => id);
  assert.equal(ids.includes('a') && ids.includes('c'), false);
  assert.throws(() => selectMissing([
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
  ], 1, () => 0), /Cyclic/);
});

test('independent overseas dependencies can disappear with their sovereign country', () => {
  const independent = hierarchicalPlaces.slice(-2);
  assert.deepEqual(selectMissing(independent, 2, () => 0).map(({ id }) => id), ['grl', 'dnk']);
});

test('country-only games exclude internal autonomous regions from their pool', () => {
  const game = createGame(hierarchicalPlaces, { pool: 'countries', count: 20, duration: null, rng: () => 0 });
  assert.deepEqual(game.start().missingIds, ['esp', 'prt', 'dnk']);
  assert.equal(game.guess('Catalonia').status, 'not-missing');
  assert.equal(game.guess('Spain').status, 'correct');
});
