import { createGame, normalizeAnswer, buildAnswerIndex } from './game.js';
import { WorldMap } from './map.js';

const $ = id => document.getElementById(id);
let data, map, game, answerIndex, mode = 'play', autoGuess, selectedPlace;
let lastSecond = null;
const clock = seconds => seconds == null ? '∞' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const placesById = new Map();
const mobileLayout = window.matchMedia('(max-width: 720px)');

function syncMobileAnswer() {
  const playing = game?.getState().phase === 'playing';
  const useDock = playing && (mobileLayout.matches || document.fullscreenElement === document.querySelector('.map-card'));
  const dock = $('mobile-guess-dock');
  const form = $('guess-form'), status = $('answer-feedback');
  if (useDock) {
    dock.append(form, status);
  } else if (form.parentElement !== $('playing-controls')) {
    $('playing-controls').prepend(form, status);
  }
  dock.hidden = !useDock;
  $('map-viewport').classList.toggle('mobile-playing', useDock && mobileLayout.matches);
}
mobileLayout.addEventListener('change', syncMobileAnswer);
const feedback = (message, type = '') => {
  $('answer-feedback').textContent = message;
  $('answer-feedback').className = `answer-feedback ${type}`;
};

function updateSetup() {
  const duration = $('duration').value === 'null' ? null : Number($('duration').value);
  $('timer').textContent = clock(duration);
  $('timer-label').textContent = duration == null ? 'YOUR PACE' : 'TIME LIMIT';
  if (!data) return;
  const pool = data.entities.filter(place => place.playable && ($('pool').value === 'all' || place.kind === 'country'));
  $('pool-note').textContent = `${pool.length} places in the pool. All 20 chosen at random.`;
  try { localStorage.setItem('meridian-preferences', JSON.stringify({ pool: $('pool').value, duration: $('duration').value })); } catch { /* Private browsing still works. */ }
}

function startRound() {
  clearTimeout(autoGuess);
  const duration = $('duration').value === 'null' ? null : Number($('duration').value);
  game = createGame(data.entities, { count: 20, duration, pool: $('pool').value });
  game.start();
  lastSecond = null;
  $('setup-controls').hidden = true;
  $('results-controls').hidden = true;
  $('playing-controls').hidden = false;
  $('game-footnote').hidden = true;
  $('nav-explore').disabled = true;
  $('nav-explore').title = 'Finish your round to explore the atlas';
  $('about-explore').disabled = true;
  $('about-explore').title = 'Finish your round to explore the atlas';
  $('answer').value = '';
  feedback('Answers are accepted as you type. Enter works too.');
  $('timer-label').textContent = duration == null ? 'NO TIME LIMIT' : 'TIME LEFT';
  map.setExploring(false);
  map.fitWorld();
  setRegionActive('world');
  renderPlaying(true);
  syncMobileAnswer();
  $('answer').focus({ preventScroll: true });
  if (mobileLayout.matches) $('mobile-guess-dock').scrollIntoView({ block: 'nearest' });
}

function renderPlaying(updateMap = false) {
  const state = game.getState();
  $('score').textContent = state.foundIds.length;
  $('timer').textContent = clock(state.remainingSeconds);
  $('mobile-round-score').textContent = `${state.foundIds.length} / 20 found`;
  $('mobile-round-timer').textContent = clock(state.remainingSeconds);
  $('timer').classList.toggle('low', state.remainingSeconds != null && state.remainingSeconds <= 30 && state.phase === 'playing');
  if (!updateMap) return;
  map.setRound(state.missingIds, state.foundIds);
  $('progress').style.width = `${state.foundIds.length / state.count * 100}%`;
  $('found-count').textContent = `${state.foundIds.length} ${state.foundIds.length === 1 ? 'place' : 'places'}`;
  $('found-list').replaceChildren();
  if (!state.foundIds.length) {
    const empty = document.createElement('li'); empty.className = 'empty-found'; empty.textContent = 'Your discoveries will appear here.'; $('found-list').append(empty);
  }
  for (const id of [...state.foundIds].reverse()) {
    const item = document.createElement('li');
    const check = document.createElement('span'); check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.textContent = placesById.get(id).name;
    item.append(check, name); $('found-list').append(item);
  }
}

function submitGuess(explicit = false) {
  if (!game || game.getState().phase !== 'playing') return;
  const answer = $('answer').value;
  if (!normalizeAnswer(answer)) return;
  if (!explicit) {
    const normalized = normalizeAnswer(answer);
    const match = answerIndex.get(normalized);
    if (!match || !game.getState().missingIds.includes(match)) return;
    const remaining = new Set(game.getState().missingIds.filter(id => !game.getState().foundIds.includes(id)));
    if ([...answerIndex].some(([alias, id]) => id !== match && remaining.has(id) && alias.startsWith(normalized))) {
      feedback(`Press Enter to submit ${placesById.get(match).name}.`);
      return;
    }
  }
  const result = game.guess(answer);
  switch (result.status) {
    case 'correct':
      $('answer').value = '';
      feedback(`${result.place.name} is back on the map.`, 'success');
      renderPlaying(true);
      break;
    case 'duplicate':
      feedback(`You already found ${result.place.name}.`);
      if (explicit) $('answer').select();
      break;
    case 'not-missing':
      feedback(`${result.place.name} is already on the map.`);
      if (explicit) $('answer').select();
      break;
    case 'unknown':
      feedback('That name wasn’t recognized. Try a full name or common alias.', 'error');
      break;
  }
  if (result.state.phase === 'ended') renderResults();
}

function renderResults() {
  clearTimeout(autoGuess);
  const state = game.getState();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  syncMobileAnswer();
  renderPlaying();
  $('playing-controls').hidden = true;
  $('results-controls').hidden = false;
  $('setup-controls').hidden = true;
  $('nav-explore').disabled = false;
  $('nav-explore').title = '';
  $('about-explore').disabled = false;
  $('about-explore').title = '';
  map.setRound();
  const won = state.endReason === 'won';
  $('result-icon').textContent = won ? '✦' : '◎';
  $('result-title').textContent = won ? 'The world is whole again.' : state.endReason === 'timeout' ? 'Time to meet the missing.' : 'A little more of the world.';
  const elapsed = Math.floor((state.endedAt - state.startedAt) / 1000);
  $('result-description').textContent = won ? `All 20 places found in ${clock(elapsed)}. Where will your next round take you?` : `You found ${state.foundIds.length} of 20 places. Select an answer below to find it on the map.`;
  $('result-count').textContent = `${state.foundIds.length}/20`;
  $('result-list').replaceChildren();
  const found = new Set(state.foundIds);
  const answers = state.missingIds.map(id => placesById.get(id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const place of answers) {
    const item = document.createElement('li'); item.className = found.has(place.id) ? 'found' : '';
    const icon = document.createElement('span'); icon.textContent = found.has(place.id) ? '✓' : '○'; icon.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button'); button.textContent = place.name;
    button.setAttribute('aria-label', `${place.name}, ${found.has(place.id) ? 'found' : 'missed'}. Locate on map.`);
    button.addEventListener('click', () => { map.focusPlace(place.id); $('map-heading').textContent = place.name.toUpperCase(); setRegionActive(); });
    item.append(icon, button); $('result-list').append(item);
  }
  $('result-title').tabIndex = -1;
  $('result-title').focus({ preventScroll: true });
}

function showSetup() {
  game = null;
  syncMobileAnswer();
  map.setRound(); map.setExploring(false); map.fitWorld();
  $('map-heading').textContent = 'THE WORLD';
  setRegionActive('world');
  $('results-controls').hidden = true; $('playing-controls').hidden = true; $('setup-controls').hidden = false;
  $('game-footnote').hidden = false;
  $('score').textContent = '0'; $('timer').classList.remove('low');
  updateSetup();
}

function switchMode(next) {
  if (!map || (game?.getState().phase === 'playing' && next === 'explore')) return;
  mode = next;
  $('game-panel').hidden = next !== 'play'; $('explore-panel').hidden = next !== 'explore';
  $('nav-play').classList.toggle('active', next === 'play'); $('nav-explore').classList.toggle('active', next === 'explore');
  for (const [id, isCurrent] of [['nav-play', next === 'play'], ['nav-explore', next === 'explore']]) {
    if (isCurrent) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  $('page-title').replaceChildren(document.createTextNode(next === 'play' ? '20 missing countries' : 'Every corner of the world'));
  const dot = document.createElement('span'); dot.textContent = '.'; $('page-title').append(dot);
  $('page-description').textContent = next === 'play' ? 'Something’s missing from the world. Find the countries and territories that have disappeared.' : 'Countries, islands, and autonomous regions. Get to know the places that make up our planet.';
  map.setExploring(next === 'explore');
  map.setRound();
  if (next === 'explore') { renderPlaceList(); $('place-search').focus({ preventScroll: true }); }
  else if (game?.getState().phase === 'playing') renderPlaying(true);
  $('map-heading').textContent = 'THE WORLD';
  map.fitWorld(); setRegionActive('world');
  if (next === 'explore' && selectedPlace) selectPlace(selectedPlace);
}

function renderPlaceList() {
  const query = normalizeAnswer($('place-search').value);
  const places = data.entities.filter(place => place.playable && (!query || [place.name, place.continent, place.sovereign, ...(place.aliases || [])].some(name => normalizeAnswer(name || '').includes(query)))).sort((a, b) => a.name.localeCompare(b.name));
  $('search-count').textContent = `${places.length} ${places.length === 1 ? 'place' : 'places'}${query ? ' found' : ' to explore'}`;
  const fragment = document.createDocumentFragment();
  for (const place of places) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.classList.toggle('active', place.id === selectedPlace);
    const name = document.createElement('span'); name.textContent = place.name;
    const type = document.createElement('span'); type.textContent = place.kind === 'country' ? 'Country' : place.parentId ? 'Region' : 'Territory';
    button.append(name, type); button.addEventListener('click', () => selectPlace(place.id)); item.append(button); fragment.append(item);
  }
  if (!places.length) { const empty = document.createElement('li'); empty.className = 'no-results'; empty.textContent = 'No places found. Try another name.'; fragment.append(empty); }
  $('place-list').replaceChildren(fragment);
}

function selectPlace(id) {
  const place = placesById.get(id);
  if (!place || !place.playable) return;
  selectedPlace = id;
  map.focusPlace(id);
  setRegionActive();
  $('map-heading').textContent = place.name.toUpperCase();
  const card = $('place-detail'); card.replaceChildren(); card.hidden = false;
  const close = document.createElement('button'); close.className = 'detail-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close place details');
  close.addEventListener('click', () => { card.hidden = true; selectedPlace = null; map.setRound(); renderPlaceList(); });
  const title = document.createElement('h3'); title.textContent = place.name;
  const details = document.createElement('dl');
  for (const [term, value] of [['Type', place.subtype || (place.kind === 'country' ? 'Country' : 'Territory')], ['Region', place.continent], ['Part of', place.parentId ? placesById.get(place.parentId)?.name : place.sovereign && place.sovereign !== place.name ? place.sovereign : null]]) {
    if (!value) continue;
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value;
    details.append(dt, dd);
  }
  card.append(close, title, details); renderPlaceList();
  if (place.statusNote) {
    const note = document.createElement('p'); note.className = 'detail-note'; note.textContent = place.statusNote; card.append(note);
  }
}

function setRegionActive(name) {
  document.querySelectorAll('.region').forEach(button => button.classList.toggle('active', button.dataset.region === name));
}

$('start').addEventListener('click', startRound);
$('pool').addEventListener('change', updateSetup);
$('duration').addEventListener('change', updateSetup);
$('guess-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(autoGuess); submitGuess(true); });
$('answer').addEventListener('input', () => { clearTimeout(autoGuess); autoGuess = setTimeout(() => submitGuess(false), 180); });
$('give-up').addEventListener('click', () => { game.end(); renderResults(); });
$('play-again').addEventListener('click', () => { showSetup(); $('start').focus({ preventScroll: true }); });
$('nav-play').addEventListener('click', () => switchMode('play'));
$('nav-explore').addEventListener('click', () => switchMode('explore'));
$('place-search').addEventListener('input', renderPlaceList);
for (const id of ['nav-about', 'coverage-link', 'footer-sources']) $(id).addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
$('about-dialog').addEventListener('click', event => { if (event.target === $('about-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('about-explore').addEventListener('click', () => { $('about-dialog').close(); switchMode('explore'); });
$('zoom-in').addEventListener('click', () => { map?.zoom(2); setRegionActive(); });
$('zoom-out').addEventListener('click', () => { map?.zoom(.5); setRegionActive(); });
$('zoom-home').addEventListener('click', () => { map?.fitWorld(); setRegionActive('world'); $('map-heading').textContent = 'THE WORLD'; });
document.querySelectorAll('.region').forEach(button => button.addEventListener('click', () => { map?.region(button.dataset.region); setRegionActive(button.dataset.region); $('map-heading').textContent = button.dataset.region === 'world' ? 'THE WORLD' : button.dataset.region.toUpperCase(); }));
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.map-card').requestFullscreen();
  } catch { $('map-viewport').focus(); }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit expanded map' : 'Expand map');
  syncMobileAnswer();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && game?.getState().phase === 'playing') {
    const state = game.tick(); renderPlaying(); if (state.phase === 'ended') renderResults();
  }
});
setInterval(() => {
  if (!game || game.getState().phase !== 'playing') return;
  const state = game.tick();
  if (state.remainingSeconds !== lastSecond) { renderPlaying(); lastSecond = state.remainingSeconds; }
  if (state.phase === 'ended') renderResults();
}, 250);

async function loadWorld() {
  try {
    const response = await fetch(new URL('../data/world.json', import.meta.url));
    if (!response.ok) throw new Error(`Map request failed (${response.status})`);
    data = await response.json();
    for (const place of data.entities) placesById.set(place.id, place);
    answerIndex = buildAnswerIndex(data.entities);
    map = new WorldMap($('map-viewport'), data, {
      onSelect: id => { if (mode === 'explore') selectPlace(id); },
      onZoom: zoom => $('zoom-level').textContent = `${zoom < 10 ? Number(zoom.toFixed(1)) : Math.round(zoom)}×`,
      detailUrl: new URL('../data/world-detail.json', import.meta.url),
      onDetail: status => $('map-detail').textContent = status === 'loading' ? 'Loading finer coastlines…' : status === 'error' ? 'Standard coastlines · Detail unavailable' : 'Detailed coastlines · Island-level zoom',
    });
    $('map-loading').hidden = true;
    const playable = data.entities.filter(place => place.playable);
    const countries = playable.filter(place => place.kind === 'country').length;
    const internal = playable.filter(place => place.parentId).length;
    const territories = playable.length - countries - internal;
    $('coverage-count').textContent = playable.length;
    $('coverage-description').textContent = `${playable.length} playable places: ${countries} countries, ${territories} separately administered or disputed territories, and ${internal} internal autonomous regions. This includes small island countries, self-governing dependencies, Abkhazia, and South Ossetia. A country and one of its internal regions never disappear together; a missing country takes its internal regions with it. Overseas dependencies remain separate answers. Coverage follows the included boundary datasets and is not an exhaustive catalog of all local autonomous districts.`;
    try {
      const prefs = JSON.parse(localStorage.getItem('meridian-preferences'));
      if (['all', 'countries'].includes(prefs?.pool)) $('pool').value = prefs.pool;
      if (['600', '210', 'null'].includes(prefs?.duration)) $('duration').value = prefs.duration;
    } catch { /* Defaults work when persistence is unavailable. */ }
    updateSetup();
    $('start').disabled = false;
    renderPlaceList();
  } catch (error) {
    $('map-loading').replaceChildren();
    const message = document.createElement('span'); message.textContent = 'The map couldn’t load. Check your connection and try again.';
    const retry = document.createElement('button'); retry.className = 'primary-button'; retry.style.width = '150px'; retry.textContent = 'Try again'; retry.addEventListener('click', loadWorld);
    $('map-loading').append(message, retry);
    $('pool-note').textContent = 'Waiting for map data.';
    console.error(error);
  }
}
loadWorld();
