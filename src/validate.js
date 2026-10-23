// Schema checks (a small JSON Schema subset, no dependencies) and plan checks.
// Every function returns an array of { path, message }; empty means valid.

const EPS = 1e-6;

// ---------------------------------------------------------------- JSON Schema

export function validateSchema(schema, data, root = schema, path = '$') {
  const errors = [];
  const push = (message, p = path) => errors.push({ path: p, message });

  if (schema === true) return errors;
  if (schema === false) { push('not allowed'); return errors; }

  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) { push(`unresolvable $ref ${schema.$ref}`); return errors; }
    return validateSchema(target, data, root, path);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, data))) {
      push(`expected ${types.join('|')}, got ${describe(data)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, data)) push(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((v) => deepEqual(v, data))) push(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) push(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) push(`must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) push(`must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) push(`must be < ${schema.exclusiveMaximum}`);
    if (schema.multipleOf !== undefined && Math.abs(data / schema.multipleOf - Math.round(data / schema.multipleOf)) > EPS) push(`must be a multiple of ${schema.multipleOf}`);
  }
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) push(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && data.length > schema.maxLength) push(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) push(`must match /${schema.pattern}/`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) push(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) push(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems) {
      const seen = new Set();
      data.forEach((v, i) => { const k = JSON.stringify(v); if (seen.has(k)) push('duplicate item', `${path}[${i}]`); seen.add(k); });
    }
    if (schema.items !== undefined) data.forEach((v, i) => errors.push(...validateSchema(schema.items, v, root, `${path}[${i}]`)));
  }
  if (isObject(data)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in data)) push(`missing required property "${key}"`);
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in props) errors.push(...validateSchema(props[key], value, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) push(`unexpected property "${key}"`);
      else if (isObject(schema.additionalProperties)) errors.push(...validateSchema(schema.additionalProperties, value, root, `${path}.${key}`));
    }
  }
  if (schema.allOf) for (const s of schema.allOf) errors.push(...validateSchema(s, data, root, path));
  if (schema.anyOf && !schema.anyOf.some((s) => validateSchema(s, data, root, path).length === 0)) push('does not match any allowed shape (anyOf)');
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validateSchema(s, data, root, path).length === 0).length;
    if (n !== 1) push(`must match exactly one shape (oneOf), matched ${n}`);
  }
  return errors;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) return null;
  return ref.slice(2).split('/').reduce((node, key) => (node == null ? null : node[key.replace(/~1/g, '/').replace(/~0/g, '~')]), root);
}
function matchesType(t, v) {
  switch (t) {
    case 'object': return isObject(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`);
}

// ---------------------------------------------------------------- plan checks

const byId = (list, key = 'id') => Object.fromEntries((list || []).map((x) => [x[key], x]));
const dupes = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

export function checkSpec(spec, photoIds) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  const rooms = byId(spec.rooms);
  for (const d of dupes(spec.rooms.map((r) => r.id))) push('$.rooms', `duplicate room id "${d}"`);
  for (const d of dupes(spec.photos.map((p) => p.id))) push('$.photos', `duplicate photo id "${d}"`);
  for (const d of dupes(spec.materials.map((m) => m.id))) push('$.materials', `duplicate material id "${d}"`);

  const mapped = new Set(spec.photos.map((p) => p.id));
  for (const id of photoIds) if (!mapped.has(id)) push('$.photos', `photo "${id}" is not mapped to a room`);
  spec.photos.forEach((p, i) => {
    if (!photoIds.includes(p.id)) push(`$.photos[${i}].id`, `unknown photo "${p.id}" (inputs: ${photoIds.join(', ')})`);
    if (!rooms[p.room]) push(`$.photos[${i}].room`, `unknown room "${p.room}"`);
  });
  const materials = byId(spec.materials);
  spec.rooms.forEach((r, i) => {
    for (const k of ['floor', 'walls', 'ceiling']) {
      if (r[k] !== undefined && !materials[r[k]]) push(`$.rooms[${i}].${k}`, `material "${r[k]}" is not declared in materials`);
    }
  });
  spec.materials.forEach((m, i) => (m.rooms || []).forEach((rid, j) => { if (!rooms[rid]) push(`$.materials[${i}].rooms[${j}]`, `unknown room "${rid}"`); }));
  spec.objects.forEach((o, i) => { if (!rooms[o.room]) push(`$.objects[${i}].room`, `unknown room "${o.room}"`); });
  spec.light.forEach((l, i) => { if (!rooms[l.room]) push(`$.light[${i}].room`, `unknown room "${l.room}"`); });
  const litRooms = new Set(spec.light.map((l) => l.room));
  for (const r of spec.rooms) if (!litRooms.has(r.id)) push('$.light', `room "${r.id}" has no light entry`);
  return errors;
}

// Walls of a rect, in plan: x east, z south. n = min z, s = max z, w = min x, e = max x.
export function wallSegment(rect, wall) {
  switch (wall) {
    case 'n': return { axis: 'x', fixed: rect.z, from: rect.x, to: rect.x + rect.w };
    case 's': return { axis: 'x', fixed: rect.z + rect.d, from: rect.x, to: rect.x + rect.w };
    case 'w': return { axis: 'z', fixed: rect.x, from: rect.z, to: rect.z + rect.d };
    case 'e': return { axis: 'z', fixed: rect.x + rect.w, from: rect.z, to: rect.z + rect.d };
    default: return null;
  }
}
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

function rectsOverlap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return ox > EPS && oz > EPS;
}
function sharedEdge(a, wall, b) {
  const sa = wallSegment(a, wall), sb = wallSegment(b, OPPOSITE[wall]);
  if (Math.abs(sa.fixed - sb.fixed) > 1e-3) return null;
  const from = Math.max(sa.from, sb.from), to = Math.min(sa.to, sb.to);
  return to - from > EPS ? { from, to } : null;
}

export function checkLayout(layout, spec) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  const levels = byId(layout.levels);
  const rooms = byId(layout.rooms);
  const specRooms = byId(spec.rooms);
  const materials = new Set(spec.materials.map((m) => m.id));
  for (const d of dupes(layout.levels.map((l) => l.id))) push('$.levels', `duplicate level id "${d}"`);
  for (const d of dupes(layout.rooms.map((r) => r.id))) push('$.rooms', `duplicate room id "${d}"`);
  for (const d of dupes(layout.openings.map((o) => o.id))) push('$.openings', `duplicate opening id "${d}"`);

  for (const r of spec.rooms) if (!rooms[r.id]) push('$.rooms', `spec room "${r.id}" has no rectangle in the layout`);
  const fp = layout.footprint;
  layout.rooms.forEach((r, i) => {
    const p = `$.rooms[${i}]`;
    if (!specRooms[r.id]) push(`${p}.id`, `room "${r.id}" is not in the spec`);
    if (!levels[r.level]) push(`${p}.level`, `unknown level "${r.level}"`);
    const { x, z, w, d } = r.rect;
    if (x < fp.x - EPS || z < fp.z - EPS || x + w > fp.x + fp.w + EPS || z + d > fp.z + fp.d + EPS) {
      push(`${p}.rect`, `room "${r.id}" does not fit inside the footprint (${fp.w} x ${fp.d} m at ${fp.x},${fp.z})`);
    }
    if (!materials.has(r.floor)) push(`${p}.floor`, `floor material "${r.floor}" is not in spec.materials`);
    if (!materials.has(r.walls)) push(`${p}.walls`, `wall material "${r.walls}" is not in spec.materials`);
    const h = roomHeight(r, levels);
    if (h && h < 2) push(`${p}.ceilingHeight`, `room "${r.id}" is under 2 m tall`);
  });
  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      const a = layout.rooms[i], b = layout.rooms[j];
      if (a.level === b.level && rectsOverlap(a.rect, b.rect)) push('$.rooms', `rooms "${a.id}" and "${b.id}" overlap on level "${a.level}"`);
    }
  }

  const adjKey = (a, b) => [a, b].sort().join('|');
  const adjacency = new Set(layout.adjacency.map(([a, b]) => adjKey(a, b)));
  layout.adjacency.forEach(([a, b], i) => {
    if (!rooms[a]) push(`$.adjacency[${i}][0]`, `unknown room "${a}"`);
    if (!rooms[b]) push(`$.adjacency[${i}][1]`, `unknown room "${b}"`);
    if (a === b) push(`$.adjacency[${i}]`, 'a room cannot be adjacent to itself');
  });

  layout.openings.forEach((o, i) => {
    const p = `$.openings[${i}]`;
    const [aId, bId] = o.between;
    const a = rooms[aId], b = rooms[bId];
    if (!a) { push(`${p}.between[0]`, `unknown room "${aId}"`); return; }
    if (bId !== 'exterior' && !b) { push(`${p}.between[1]`, `unknown room "${bId}" (use "exterior" for outside)`); return; }
    if (o.type === 'stair') {
      if (!b) push(`${p}.between`, 'a stair must connect two rooms');
      else if (a.level === b.level) push(`${p}.between`, `stair "${o.id}" connects two rooms on the same level`);
      if (b && !adjacency.has(adjKey(aId, bId))) push('$.adjacency', `stair "${o.id}" connects "${aId}" and "${bId}" but adjacency does not list them`);
      return;
    }
    const seg = wallSegment(a.rect, o.wall);
    const len = seg.to - seg.from;
    if (o.offset + o.width > len + 1e-3) push(`${p}`, `opening "${o.id}" (offset ${o.offset} + width ${o.width}) runs past the ${len.toFixed(2)} m ${o.wall} wall of "${aId}"`);
    const h = roomHeight(a, levels);
    if (h && o.sill + o.height > h + 1e-3) push(`${p}`, `opening "${o.id}" (sill ${o.sill} + height ${o.height}) is taller than room "${aId}" (${h} m)`);
    if (b) {
      if (a.level !== b.level) push(`${p}.between`, `"${aId}" and "${bId}" are on different levels; use type "stair"`);
      const edge = sharedEdge(a.rect, o.wall, b.rect);
      if (!edge) push(`${p}`, `"${bId}" is not on the ${o.wall} side of "${aId}"`);
      else {
        const s0 = seg.from + o.offset, s1 = s0 + o.width;
        if (s0 < edge.from - 1e-3 || s1 > edge.to + 1e-3) push(`${p}`, `opening "${o.id}" is not within the wall shared by "${aId}" and "${bId}"`);
      }
      if (!adjacency.has(adjKey(aId, bId))) push('$.adjacency', `opening "${o.id}" connects "${aId}" and "${bId}" but adjacency does not list them`);
    } else {
      const s0 = seg.from + o.offset, s1 = s0 + o.width;
      for (const other of layout.rooms) {
        if (other.id === aId || other.level !== a.level) continue;
        const edge = sharedEdge(a.rect, o.wall, other.rect);
        if (edge && s1 > edge.from + EPS && s0 < edge.to - EPS) push(`${p}`, `opening "${o.id}" is marked exterior but room "${other.id}" is on the other side of that wall`);
      }
    }
  });
  const openingPairs = new Set(layout.openings.filter((o) => rooms[o.between[1]]).map((o) => adjKey(...o.between)));
  layout.adjacency.forEach(([a, b], i) => {
    const ra = rooms[a], rb = rooms[b];
    if (!ra || !rb) return;
    const touching = ['n', 's', 'e', 'w'].some((w) => sharedEdge(ra.rect, w, rb.rect)) && ra.level === rb.level;
    if (!touching && !openingPairs.has(adjKey(a, b))) push(`$.adjacency[${i}]`, `"${a}" and "${b}" share no wall and no stair`);
  });

  const cams = {};
  layout.cameras.forEach((c, i) => {
    const p = `$.cameras[${i}]`;
    (cams[c.photoId] ||= []).push(i);
    const photo = spec.photos.find((ph) => ph.id === c.photoId);
    if (!photo) { push(`${p}.photoId`, `unknown photo "${c.photoId}"`); return; }
    if (c.room !== photo.room) push(`${p}.room`, `camera for "${c.photoId}" is in "${c.room}" but the spec maps that photo to "${photo.room}"`);
    const room = rooms[c.room];
    if (!room) { push(`${p}.room`, `unknown room "${c.room}"`); return; }
    const { x, z, w, d } = room.rect;
    if (c.position.x < x - EPS || c.position.x > x + w + EPS || c.position.z < z - EPS || c.position.z > z + d + EPS) {
      push(`${p}.position`, `camera for "${c.photoId}" is outside room "${c.room}" in plan`);
    }
    const lvl = levels[room.level];
    if (lvl) {
      const top = lvl.elevation + roomHeight(room, levels);
      if (c.position.y < lvl.elevation + 0.3 || c.position.y > top - 0.2) push(`${p}.position.y`, `camera for "${c.photoId}" is not between floor (${lvl.elevation}) and ceiling (${top}) of "${c.room}"`);
    }
    if (dist(c.position, c.lookAt) < 0.2) push(`${p}.lookAt`, 'lookAt is too close to the camera position');
  });
  for (const ph of spec.photos) {
    const n = (cams[ph.id] || []).length;
    if (n !== 1) push('$.cameras', `photo "${ph.id}" has ${n} cameras; exactly one is required`);
  }
  return errors;
}

function roomHeight(room, levels) {
  if (room.ceilingHeight) return room.ceilingHeight;
  const lvl = levels[room.level];
  return lvl ? lvl.height : null;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function checkEnhance(plan, photoId) {
  const errors = [];
  if (plan.photoId !== photoId) errors.push({ path: '$.photoId', message: `must be "${photoId}"` });
  return errors;
}

export function checkJudge(verdict, photoId, threshold = 4) {
  const errors = [];
  if (verdict.photoId !== photoId) errors.push({ path: '$.photoId', message: `must be "${photoId}"` });
  const expected = verdict.overall >= threshold ? 'pass' : 'redo';
  if (verdict.verdict !== expected) errors.push({ path: '$.verdict', message: `overall ${verdict.overall} means verdict must be "${expected}"` });
  return errors;
}

export function checkNarration(narration, spec) {
  const errors = [];
  const rooms = new Set(spec.rooms.map((r) => r.id));
  const seen = {};
  narration.lines.forEach((l, i) => {
    if (!rooms.has(l.room)) errors.push({ path: `$.lines[${i}].room`, message: `unknown room "${l.room}"` });
    seen[l.room] = (seen[l.room] || 0) + 1;
  });
  for (const r of rooms) {
    if ((seen[r] || 0) !== 1) errors.push({ path: '$.lines', message: `room "${r}" needs exactly one line, has ${seen[r] || 0}` });
  }
  return errors;
}
