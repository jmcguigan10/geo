const AMBIGUOUS_SHORT_NAMES = new Set(['congo', 'korea']);

/** Match only known names and aliases, ignoring accents, case, and punctuation. */
export function normalizeAnswer(answer) {
  return String(answer ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Canonical names take precedence over other places' aliases. An alias shared
 * by two places is omitted, so ambiguous answers cannot reveal either place.
 */
export function buildAnswerIndex(places) {
  const canonical = new Map();
  const aliases = new Map();

  function add(index, answer, id) {
    const key = normalizeAnswer(answer);
    if (!key || AMBIGUOUS_SHORT_NAMES.has(key)) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(id);
  }

  for (const place of places) {
    add(canonical, place.name, place.id);
    for (const alias of place.aliases ?? []) add(aliases, alias, place.id);
  }

  const result = new Map();
  for (const [answer, ids] of canonical) {
    if (ids.size === 1) result.set(answer, ids.values().next().value);
  }
  for (const [answer, ids] of aliases) {
    if (!canonical.has(answer) && ids.size === 1) {
      result.set(answer, ids.values().next().value);
    }
  }
  return result;
}

/**
 * Shuffle playable candidates, then omit parent/descendant conflicts. Overseas
 * dependencies without a parentId remain independent of their sovereign state.
 */
export function selectMissing(places, count = 20, rng = Math.random) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('The missing-place count must be a positive integer.');
  }
  const records = new Map(places.map((place) => [place.id, place]));
  const unique = new Map();
  for (const place of places) {
    if (place.playable !== false && !unique.has(place.id)) {
      unique.set(place.id, place);
    }
  }
  const choices = [...unique.values()];
  const selectedCount = Math.min(count, choices.length);

  for (let i = 0; i < choices.length - 1; i += 1) {
    const random = rng();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError('The random source must return a number from 0 to 1, excluding 1.');
    }
    const j = i + Math.floor(random * (choices.length - i));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }

  const ancestors = new Map();
  const hasPlayableDescendant = new Set();
  for (const place of choices) {
    const ids = new Set();
    let parentId = place.parentId;
    while (parentId) {
      if (parentId === place.id || ids.has(parentId)) {
        throw new TypeError(`Cyclic place hierarchy: ${place.id}`);
      }
      ids.add(parentId);
      hasPlayableDescendant.add(parentId);
      parentId = records.get(parentId)?.parentId;
    }
    ancestors.set(place.id, ids);
  }

  const selected = [];
  for (const place of choices) {
    const conflicts = selected.some((other) => (
      ancestors.get(place.id).has(other.id) || ancestors.get(other.id).has(place.id)
    ));
    if (!conflicts) selected.push(place);
    if (selected.length === selectedCount) return selected;
  }

  // A greedy choice of a country can block several eligible internal regions.
  // Deepest playable nodes form a maximum compatible set in this parent tree,
  // retaining the shuffled order when we need to recover from that dead end.
  const compatible = choices.filter((place) => !hasPlayableDescendant.has(place.id));
  if (compatible.length < selectedCount) {
    throw new RangeError(`The pool supports only ${compatible.length} non-overlapping missing places.`);
  }
  return compatible.slice(0, selectedCount);
}

/** A DOM-independent round controller. `now` returns milliseconds. */
export function createGame(places, options = {}) {
  const {
    count = 20,
    pool = 'all',
    rng = Math.random,
    now = Date.now,
  } = options;
  const duration = options.duration === null || options.duration === 0
    ? null
    : (options.duration ?? 600);

  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('The missing-place count must be a positive integer.');
  }
  if (pool !== 'all' && pool !== 'countries') {
    throw new RangeError('The pool must be all or countries.');
  }
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    throw new RangeError('The duration must be positive, or null for an untimed round.');
  }

  const byId = new Map();
  for (const place of places) {
    if (typeof place.id !== 'string' || !place.id || !normalizeAnswer(place.name)) {
      throw new TypeError('Every place needs a nonempty string id and name.');
    }
    if (byId.has(place.id)) throw new TypeError(`Duplicate place id: ${place.id}`);
    byId.set(place.id, place);
  }

  const selectionPool = places.filter((place) => pool === 'all' || place.kind === 'country');
  const eligible = selectionPool.filter((place) => place.playable !== false);
  if (!eligible.length) throw new RangeError('The selected pool has no playable places.');

  // Build against every place, including ones outside the selected pool, so
  // narrowing the pool never turns an ambiguous alias into an accepted answer.
  const answerIndex = buildAnswerIndex(places);
  let missingIds = [];
  let missingSet = new Set();
  let foundIds = [];
  let foundSet = new Set();
  let phase = 'idle';
  let startedAt = null;
  let endedAt = null;
  let remainingSeconds = duration;
  let endReason = null;

  function getState() {
    return {
      phase,
      count: Math.min(count, eligible.length),
      pool,
      duration,
      missingIds: [...missingIds],
      foundIds: [...foundIds],
      startedAt,
      endedAt,
      remainingSeconds,
      endReason,
    };
  }

  function finish(reason, timestamp) {
    if (phase !== 'playing') return;
    phase = 'ended';
    endReason = reason;
    endedAt = timestamp;
    if (reason === 'timeout') remainingSeconds = 0;
  }

  function start() {
    missingIds = selectMissing(selectionPool, count, rng).map((place) => place.id);
    missingSet = new Set(missingIds);
    foundIds = [];
    foundSet = new Set();
    phase = 'playing';
    startedAt = now();
    endedAt = null;
    remainingSeconds = duration;
    endReason = null;
    return getState();
  }

  function tick() {
    if (phase === 'playing' && duration !== null) {
      const timestamp = now();
      const remaining = Math.max(0, Math.ceil(duration - (timestamp - startedAt) / 1000));
      remainingSeconds = Math.min(remainingSeconds, remaining);
      if (remainingSeconds === 0) finish('timeout', timestamp);
    }
    return getState();
  }

  function guess(answer) {
    tick();
    if (phase !== 'playing') return { status: 'inactive', state: getState() };

    const id = answerIndex.get(normalizeAnswer(answer));
    if (!id) return { status: 'unknown', state: getState() };
    const place = byId.get(id);
    if (!missingSet.has(id)) return { status: 'not-missing', id, place, state: getState() };
    if (foundSet.has(id)) return { status: 'duplicate', id, place, state: getState() };

    foundSet.add(id);
    foundIds.push(id);
    if (foundSet.size === missingSet.size) finish('won', now());
    return { status: 'correct', id, place, state: getState() };
  }

  function end(reason = 'gave-up') {
    tick();
    finish(reason, now());
    return getState();
  }

  return {
    start,
    guess,
    tick,
    end,
    getState,
    get state() { return getState(); },
  };
}
