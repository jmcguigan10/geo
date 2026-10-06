import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAnswerIndex, normalizeAnswer, createGame } from '../src/game.js';

const world = JSON.parse(await readFile(new URL('../public/data/world.json', import.meta.url), 'utf8'));
const detail = JSON.parse(await readFile(new URL('../public/data/world-detail.json', import.meta.url), 'utf8'));
const entities = world.entities;
const ids = new Map(entities.map(place => [place.id, place]));

test('every playable place has an unambiguous answer and real coarse/detail geometry', () => {
  const index = buildAnswerIndex(entities);
  assert.equal(ids.size, entities.length, 'stable identifiers must be unique');
  for (const place of entities.filter(place => place.playable)) {
    assert.equal(index.get(normalizeAnswer(place.name)), place.id, place.name);
    const children = entities.filter(child => child.parentId === place.id);
    assert.ok(place.d || children.length, `${place.name} must have a footprint`);
    assert.ok(detail.paths[place.id] || children.length, `${place.name} must have a detailed footprint`);
    assert.ok(place.bbox.every(Number.isFinite));
    assert.ok(place.bbox[0] < place.bbox[2] && place.bbox[1] < place.bbox[3], place.name);
    if (place.parentId) assert.ok(ids.has(place.parentId), `${place.name} must have a known parent`);
  }
});

test('the live pool includes requested disputed places, microstates and self-governing islands', () => {
  const names = new Set(entities.filter(place => place.playable).map(place => place.name));
  for (const name of ['Abkhazia', 'South Ossetia', 'Vatican City', 'Monaco', 'Nauru', 'Tuvalu', 'Cook Islands', 'Niue', 'Greenland', 'Faroe Islands', 'Scotland', 'Jersey', 'Guernsey', 'Sark', 'Alderney']) assert.ok(names.has(name), name);
  assert.equal(entities.filter(place => place.kind === 'country' && place.playable).length, 197);
  assert.equal(world.fillRule, 'nonzero');
  assert.equal(world.coverage.countries, 197);
  assert.equal(world.coverage.autonomousRegions, entities.filter(place => place.parentId && place.playable).length);
  assert.equal(world.coverage.territories, entities.filter(place => place.kind === 'territory' && place.playable).length);
});

test('common abbreviations and Saint spellings resolve in the actual answer inventory', () => {
  const index = buildAnswerIndex(entities);
  const expected = { USA: 'United States', UK: 'United Kingdom', UAE: 'United Arab Emirates', DRC: 'Democratic Republic of the Congo', 'St Lucia': 'Saint Lucia', 'Hong Kong SAR': 'Hong Kong', 'Iraqi Kurdistan': 'Kurdistan Region' };
  for (const [alias, name] of Object.entries(expected)) assert.equal(ids.get(index.get(normalizeAnswer(alias)))?.name, name, alias);
  assert.equal(index.has('congo'), false);
  assert.equal(index.has('korea'), false);
});

test('200 seeded rounds on the real world data always produce 20 compatible, answerable places', () => {
  let seed = 391831;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let round = 0; round < 200; round++) {
    const game = createGame(entities, { rng, duration: null, pool: round % 2 ? 'all' : 'countries' });
    const state = game.start();
    assert.equal(new Set(state.missingIds).size, 20);
    const selected = new Set(state.missingIds);
    for (const id of selected) {
      let parent = ids.get(id).parentId;
      const visited = new Set();
      while (parent) {
        assert.ok(!selected.has(parent), 'parent and child must not disappear together');
        assert.ok(!visited.has(parent), 'hierarchy must be acyclic');
        visited.add(parent); parent = ids.get(parent)?.parentId;
      }
      assert.equal(game.guess(ids.get(id).name).status, 'correct');
    }
    assert.equal(game.state.endReason, 'won');
  }
});
