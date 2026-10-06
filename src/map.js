const SVG = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WorldMap {
  constructor(viewport, data, { onSelect, onZoom, detailUrl, onDetail } = {}) {
    this.viewport = viewport;
    this.svg = viewport.querySelector('svg');
    this.data = data;
    this.entities = new Map(data.entities.map(place => [place.id, place]));
    this.paths = new Map();
    this.onSelect = onSelect;
    this.onZoom = onZoom;
    this.detailUrl = detailUrl;
    this.onDetail = onDetail;
    this.detailStatus = 'idle';
    this.detailShown = false;
    this.points = new Map();
    this.exploring = false;
    this.frame = null;
    this.group = document.createElementNS(SVG, 'g');
    this.landBase = document.createElementNS(SVG, 'path');
    this.landBase.setAttribute('class', 'land-base');
    this.landBase.setAttribute('fill-rule', 'nonzero');
    this.group.append(this.landBase);
    const fragment = document.createDocumentFragment();
    for (const place of data.entities) {
      if (!place.d) continue;
      const shape = document.createElementNS(SVG, 'path');
      shape.setAttribute('d', place.d);
      shape.setAttribute('class', 'country-path');
      shape.setAttribute('fill-rule', 'nonzero');
      shape.dataset.id = place.id;
      this.paths.set(place.id, shape);
      fragment.append(shape);
    }
    this.group.append(fragment);
    this.oceanLabels = document.createElementNS(SVG, 'g');
    for (const [label, x, y] of [['PACIFIC', 600, 740], ['ATLANTIC', 1440, 730], ['INDIAN', 2460, 1070], ['PACIFIC', 3360, 860]]) {
      const text = document.createElementNS(SVG, 'text');
      text.setAttribute('x', x); text.setAttribute('y', y);
      text.setAttribute('class', 'map-ocean-label');
      text.textContent = label;
      this.oceanLabels.append(text);
    }
    this.group.append(this.oceanLabels);
    this.svg.append(this.group);
    this.resize(true);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(viewport);
    this.bindEvents();
  }

  resize(initial = false) {
    const oldWidth = this.width || 0;
    const oldHeight = this.height || 0;
    this.width = this.viewport.clientWidth;
    this.height = this.viewport.clientHeight;
    if (!this.width || !this.height) return;
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    const oldBase = this.baseScale;
    this.baseScale = Math.min(this.width / this.data.width, this.height / this.data.height) * .94;
    if (initial || !oldBase || this.scale / oldBase < 1.02) this.fitWorld();
    else {
      const cx = (oldWidth / 2 - this.x) / this.scale;
      const cy = (oldHeight / 2 - this.y) / this.scale;
      this.scale = this.scale / oldBase * this.baseScale;
      this.x = this.width / 2 - cx * this.scale;
      this.y = this.height / 2 - cy * this.scale;
      this.schedule();
    }
  }

  fitWorld() {
    this.scale = this.baseScale;
    this.x = (this.width - this.data.width * this.scale) / 2;
    this.y = (this.height - this.data.height * this.scale) / 2;
    this.schedule();
  }

  fitBounds(bounds, padding = 45) {
    const [x0, y0, x1, y1] = bounds;
    this.scale = clamp(Math.min((this.width - padding * 2) / Math.max(x1 - x0, .4), (this.height - padding * 2) / Math.max(y1 - y0, .4)), this.baseScale, this.baseScale * 2048);
    this.x = this.width / 2 - (x0 + x1) / 2 * this.scale;
    this.y = this.height / 2 - (y0 + y1) / 2 * this.scale;
    this.schedule();
  }

  region(name) {
    const bounds = { europe: [1550, 130, 2300, 590], caribbean: [910, 620, 1280, 800], pacific: [3070, 680, 3580, 1180] };
    if (bounds[name]) this.fitBounds(bounds[name]);
    else this.fitWorld();
  }

  zoom(factor, px = this.width / 2, py = this.height / 2) {
    const next = clamp(this.scale * factor, this.baseScale, this.baseScale * 2048);
    const ratio = next / this.scale;
    this.x = px - (px - this.x) * ratio;
    this.y = py - (py - this.y) * ratio;
    this.scale = next;
    this.schedule();
  }

  focusPlace(id) {
    const place = this.entities.get(id);
    if (!place) return;
    let bounds = place.bbox;
    if (bounds[2] - bounds[0] > 2800 && place.center) {
      const [cx, cy] = place.center;
      bounds = [cx - 180, cy - 120, cx + 180, cy + 120];
    }
    this.fitBounds(bounds, Math.min(this.width, this.height) * .18);
    for (const [pathId, shape] of this.paths) shape.classList.toggle('selected', pathId === id || this.isDescendant(pathId, new Set([id])));
  }

  isDescendant(id, parents) {
    const visited = new Set();
    let place = this.entities.get(id);
    while (place?.parentId && !visited.has(place.parentId)) {
      if (parents.has(place.parentId)) return true;
      visited.add(place.parentId);
      place = this.entities.get(place.parentId);
    }
    return false;
  }

  setRound(missingIds = [], foundIds = []) {
    const found = new Set(foundIds);
    const hidden = new Set(missingIds.filter(id => !found.has(id)));
    for (const [id, shape] of this.paths) {
      shape.classList.toggle('missing', hidden.has(id) || this.isDescendant(id, hidden));
      shape.classList.remove('selected');
    }
    this.schedule();
  }

  setExploring(value) {
    this.exploring = value;
    this.viewport.classList.toggle('exploring', value);
    this.viewport.querySelector('.map-tooltip').hidden = true;
    if (!value) for (const shape of this.paths.values()) shape.classList.remove('selected');
  }

  async loadDetail() {
    if (!this.detailUrl || this.detailStatus === 'loading' || this.detailStatus === 'loaded') return;
    this.detailStatus = 'loading';
    this.onDetail?.('loading');
    try {
      const response = await fetch(this.detailUrl);
      if (!response.ok) throw new Error('Detail map unavailable');
      const detail = await response.json();
      if (!detail.paths || typeof detail.paths !== 'object') throw new Error('Invalid detail map');
      this.detailPaths = detail.paths;
      this.detailStatus = 'loaded';
      this.onDetail?.('loaded');
      this.schedule();
    } catch {
      this.detailStatus = 'error';
      this.onDetail?.('error');
    }
  }

  updateResolution(level) {
    if (level > 8 && this.detailUrl && this.detailStatus === 'idle') this.loadDetail();
    const showDetail = Boolean(this.detailPaths && level >= 6);
    if (showDetail !== this.detailShown) {
      for (const [id, shape] of this.paths) shape.setAttribute('d', showDetail ? this.detailPaths[id] || this.entities.get(id).d : this.entities.get(id).d);
      this.detailShown = showDetail;
    }
    const left = -this.x / this.scale, top = -this.y / this.scale;
    const right = left + this.width / this.scale, bottom = top + this.height / this.scale;
    const visibleIds = [];
    for (const [id, shape] of this.paths) {
      const box = this.entities.get(id).bbox;
      shape.classList.toggle('culled', level > 2 && Boolean(box) && (box[2] < left || box[0] > right || box[3] < top || box[1] > bottom));
      if (!shape.classList.contains('culled') && !shape.classList.contains('missing')) visibleIds.push(id);
    }
    const key = `${showDetail}:${visibleIds.join(',')}`;
    if (key !== this.landKey) {
      // One compound fill eliminates antialias seams between adjacent green
      // polygons. Country paths above it remain transparent hit targets.
      this.landBase.setAttribute('d', visibleIds.map(id => this.paths.get(id).getAttribute('d')).join(''));
      this.landKey = key;
    }
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const cw = this.data.width * this.scale, ch = this.data.height * this.scale;
      this.x = cw < this.width ? (this.width - cw) / 2 : clamp(this.x, this.width - cw - 60, 60);
      this.y = ch < this.height ? (this.height - ch) / 2 : clamp(this.y, this.height - ch - 60, 60);
      this.group.setAttribute('transform', `translate(${this.x} ${this.y}) scale(${this.scale})`);
      const level = this.scale / this.baseScale;
      this.updateResolution(level);
      this.oceanLabels.style.display = level > 2.2 ? 'none' : '';
      this.onZoom?.(level);
    });
  }

  bindEvents() {
    const position = event => {
      const bounds = this.viewport.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
    const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    this.viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const p = position(event);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      this.zoom(Math.exp(-clamp(delta, -250, 250) * .004), p.x, p.y);
    }, { passive: false });
    this.viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const p = position(event);
      this.points.set(event.pointerId, p);
      this.clickOrigin = { ...p, id: event.target.dataset.id, moved: false };
      if (this.points.size > 1) this.clickOrigin.moved = true;
      this.viewport.setPointerCapture(event.pointerId);
      this.viewport.classList.add('dragging');
      this.viewport.querySelector('.map-tooltip').hidden = true;
    });
    this.viewport.addEventListener('pointermove', event => {
      const p = position(event);
      if (!this.points.has(event.pointerId)) {
        const place = this.entities.get(event.target.dataset.id);
        const tooltip = this.viewport.querySelector('.map-tooltip');
        tooltip.hidden = !this.exploring || !place || !place.playable;
        if (!tooltip.hidden) {
          tooltip.textContent = place.name;
          tooltip.style.left = `${clamp(p.x + 12, 8, this.width - Math.min(240, place.name.length * 7 + 20))}px`;
          tooltip.style.top = `${clamp(p.y + 15, 8, this.height - 35)}px`;
        }
        return;
      }
      const before = [...this.points.values()];
      const previous = this.points.get(event.pointerId);
      this.points.set(event.pointerId, p);
      if (this.clickOrigin && Math.hypot(p.x - this.clickOrigin.x, p.y - this.clickOrigin.y) > 4) this.clickOrigin.moved = true;
      if (this.points.size === 2) {
        const after = [...this.points.values()];
        const oldMid = midpoint(before), newMid = midpoint(after);
        this.zoom(distance(after) / Math.max(distance(before), 1), oldMid.x, oldMid.y);
        this.x += newMid.x - oldMid.x; this.y += newMid.y - oldMid.y;
        if (this.clickOrigin) this.clickOrigin.moved = true;
      } else {
        this.x += p.x - previous.x; this.y += p.y - previous.y;
      }
      this.schedule();
    });
    const release = event => {
      if (!this.points.has(event.pointerId)) return;
      this.points.delete(event.pointerId);
      if (this.points.size === 0) {
        this.viewport.classList.remove('dragging');
        if (event.type === 'pointerup' && this.exploring && !this.clickOrigin?.moved && this.clickOrigin?.id) this.onSelect?.(this.clickOrigin.id);
        this.clickOrigin = null;
      }
    };
    this.viewport.addEventListener('pointerup', release);
    this.viewport.addEventListener('pointercancel', release);
    this.viewport.addEventListener('lostpointercapture', release);
    this.viewport.addEventListener('pointerleave', () => this.viewport.querySelector('.map-tooltip').hidden = true);
    this.viewport.addEventListener('dblclick', event => {
      if (event.target.closest('button')) return;
      const p = position(event); this.zoom(2, p.x, p.y);
    });
    this.viewport.addEventListener('keydown', event => {
      if (event.target !== this.viewport) return;
      const pans = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (pans[event.key]) {
        event.preventDefault(); this.x += pans[event.key][0]; this.y += pans[event.key][1]; this.schedule();
      } else if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '0') this.fitWorld(); else this.zoom(event.key === '-' ? 1 / 1.6 : 1.6);
      }
    });
  }
}
