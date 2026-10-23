// catalog: the keyed libraries the layout step chooses from. This file is DATA ONLY
// (keys, labels, real-world sizes, placement zones) so the validator, the prompt and
// Node tests can import it. How each key looks is decided in viewer.js alone.
//
// Plan coordinates: x east, z south, y up. A furniture item is placed by the centre of its
// footprint (x, z) and `rotation` in degrees clockwise from north: 0 faces north (-z),
// 90 faces east, 180 south, 270 west. Footprints are { w (left-right), d (front-back), h }.

export const materials = {
  walnut: { label: 'Walnut panels', family: 'wood', description: 'dark walnut veneer panels with shadow reveals', tile: 1.2 },
  white_oak: { label: 'White oak planks', family: 'wood', description: 'pale rift-sawn oak planks, matte oil', tile: 2.0 },
  terrazzo: { label: 'Terrazzo', family: 'stone', description: 'warm grey terrazzo with marble chips and brass divider strips', tile: 1.8 },
  board_concrete: { label: 'Board-formed concrete', family: 'concrete', description: 'board-formed concrete with tie holes', tile: 2.4 },
  marble_viola: { label: 'Viola marble', family: 'stone', description: 'white marble with bold purple-grey veins, honed', tile: 1.6 },
  marble_white: { label: 'White marble', family: 'stone', description: 'white marble with soft grey veins, honed', tile: 1.6 },
  plaster: { label: 'Lime plaster', family: 'plaster', description: 'warm white lime plaster, matte', tile: 2.0 },
  limestone: { label: 'Limestone', family: 'stone', description: 'pale beige limestone slabs with fine joints', tile: 1.2 },
  redwood_deck: { label: 'Redwood deck', family: 'wood', description: 'redwood deck boards with gaps', tile: 1.5 },
  tile_white: { label: 'White tile', family: 'tile', description: 'glossy white square tiles with pale grout', tile: 0.6 },
  carpet_wool: { label: 'Wool carpet', family: 'textile', description: 'oatmeal wool loop carpet', tile: 1.0 },
  painted_brick: { label: 'Painted brick', family: 'masonry', description: 'running-bond brick painted off-white', tile: 1.2 },
  cladding_dark: { label: 'Dark timber cladding', family: 'wood', description: 'charred black vertical timber boards', tile: 1.2 },
};

// zone: 'floor' items take part in the overlap check; 'rug' lies under others; 'hanging' hangs from
// the ceiling; 'tabletop' sits on top of whatever floor item is beneath it (else on the floor).
export const furniture = {
  sofa_l: { label: 'L-shaped sofa', footprint: { w: 2.8, d: 1.8, h: 0.78 }, zone: 'floor', description: 'L-shaped sectional, chaise on the right' },
  sofa_straight: { label: 'Straight sofa', footprint: { w: 2.2, d: 0.9, h: 0.8 }, zone: 'floor', description: 'three-seat sofa' },
  lounge_chair: { label: 'Lounge chair', footprint: { w: 0.8, d: 0.85, h: 0.75 }, zone: 'floor', description: 'low lounge chair' },
  ottoman: { label: 'Ottoman', footprint: { w: 0.7, d: 0.7, h: 0.4 }, zone: 'floor', description: 'square upholstered ottoman' },
  coffee_table_plinth: { label: 'Plinth coffee table', footprint: { w: 1.2, d: 0.7, h: 0.33 }, zone: 'floor', description: 'low solid plinth coffee table' },
  dining_table: { label: 'Dining table', footprint: { w: 2.0, d: 0.95, h: 0.74 }, zone: 'floor', description: 'rectangular dining table for six' },
  dining_chair: { label: 'Dining chair', footprint: { w: 0.48, d: 0.52, h: 0.85 }, zone: 'floor', description: 'simple timber chair (also a desk chair)' },
  island_waterfall: { label: 'Waterfall island', footprint: { w: 2.4, d: 1.0, h: 0.9 }, zone: 'floor', description: 'kitchen island with a stone top that runs down both ends' },
  counter_run: { label: 'Counter run', footprint: { w: 3.0, d: 0.6, h: 0.9 }, zone: 'floor', description: 'base cabinets with a stone counter, against a wall' },
  bar_stool: { label: 'Bar stool', footprint: { w: 0.4, d: 0.4, h: 0.72 }, zone: 'floor', description: 'round-seat counter stool' },
  bed_king: { label: 'King bed', footprint: { w: 1.95, d: 2.15, h: 0.95 }, zone: 'floor', description: 'king bed with a low headboard at the back' },
  bed_queen: { label: 'Queen bed', footprint: { w: 1.65, d: 2.1, h: 0.95 }, zone: 'floor', description: 'queen bed with a low headboard at the back' },
  nightstand: { label: 'Nightstand', footprint: { w: 0.5, d: 0.45, h: 0.55 }, zone: 'floor', description: 'bedside cabinet' },
  bench: { label: 'Bench', footprint: { w: 1.2, d: 0.42, h: 0.45 }, zone: 'floor', description: 'upholstered bench' },
  credenza: { label: 'Credenza', footprint: { w: 1.8, d: 0.45, h: 0.7 }, zone: 'floor', description: 'low sideboard / console' },
  bookshelf_wall: { label: 'Wall bookshelf', footprint: { w: 2.0, d: 0.32, h: 2.2 }, zone: 'floor', description: 'tall open shelving against a wall (spines have no text)' },
  fireplace_concrete: { label: 'Concrete fireplace', footprint: { w: 1.8, d: 0.5, h: 2.4 }, zone: 'floor', description: 'concrete chimney breast with a firebox, against a wall' },
  tub_freestanding: { label: 'Freestanding tub', footprint: { w: 1.7, d: 0.8, h: 0.58 }, zone: 'floor', description: 'oval freestanding bath' },
  vanity_double: { label: 'Double vanity', footprint: { w: 1.6, d: 0.55, h: 0.85 }, zone: 'floor', description: 'wall vanity with two basins and a mirror above' },
  desk: { label: 'Desk', footprint: { w: 1.6, d: 0.75, h: 0.74 }, zone: 'floor', description: 'writing desk' },
  rug: { label: 'Rug', footprint: { w: 3.0, d: 2.2, h: 0.015 }, zone: 'rug', description: 'flat-weave rug, lies under other furniture' },
  plant_tree: { label: 'Indoor tree', footprint: { w: 0.6, d: 0.6, h: 2.0 }, zone: 'floor', description: 'potted indoor tree' },
  plant_small: { label: 'Small plant', footprint: { w: 0.35, d: 0.35, h: 0.6 }, zone: 'tabletop', description: 'potted plant, on a surface or the floor' },
  pendant_globe: { label: 'Globe pendant', footprint: { w: 0.35, d: 0.35, h: 0.35 }, zone: 'hanging', description: 'opal globe pendant hanging from the ceiling' },
  floor_lamp: { label: 'Floor lamp', footprint: { w: 0.4, d: 0.4, h: 1.6 }, zone: 'floor', description: 'slim floor lamp with a drum shade' },
  table_lamp: { label: 'Table lamp', footprint: { w: 0.3, d: 0.3, h: 0.5 }, zone: 'tabletop', description: 'small lamp, on a surface' },
};

export const environments = {
  bay_view: { label: 'Bay view', description: 'water to the horizon, low hills beyond, a few trees near the house' },
  city_view: { label: 'City view', description: 'towers in the middle distance, paved ground' },
  garden: { label: 'Garden', description: 'lawn, hedges and trees close to the windows' },
  forest: { label: 'Forest', description: 'dense trees all around' },
  neutral_sky: { label: 'Neutral sky', description: 'open sky over plain ground' },
};

export const MATERIAL_KEYS = Object.freeze(Object.keys(materials));
export const FURNITURE_KEYS = Object.freeze(Object.keys(furniture));
export const ENVIRONMENT_KEYS = Object.freeze(Object.keys(environments));

// Axis-aligned extents (metres) of an item's footprint after rotation, centred on (x, z).
export function footprintBox(itemKey, x, z, rotationDeg = 0) {
  const f = furniture[itemKey];
  if (!f) return null;
  const r = ((rotationDeg % 360) + 360) % 360;
  const a = (r * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const snap = (v) => Math.round(v * 1e6) / 1e6; // keep 90° turns exact
  const w = snap(f.footprint.w * c + f.footprint.d * s);
  const d = snap(f.footprint.w * s + f.footprint.d * c);
  return { x0: snap(x - w / 2), x1: snap(x + w / 2), z0: snap(z - d / 2), z1: snap(z + d / 2), w, d, area: snap(f.footprint.w * f.footprint.d) };
}

// The catalog as text for the layout prompt.
export function describeCatalog() {
  const m = MATERIAL_KEYS.map((k) => `- ${k}: ${materials[k].description}`).join('\n');
  const f = FURNITURE_KEYS.map((k) => { const { w, d, h } = furniture[k].footprint; return `- ${k}: ${furniture[k].description} (${w} x ${d} m, ${h} m tall${furniture[k].zone !== 'floor' ? `, ${furniture[k].zone}` : ''})`; }).join('\n');
  const e = ENVIRONMENT_KEYS.map((k) => `- ${k}: ${environments[k].description}`).join('\n');
  return `MATERIAL KEYS (for rooms[].floor, rooms[].walls, rooms[].ceiling and furniture[].material):\n${m}\n\nFURNITURE KEYS (footprint w x d at rotation 0, w runs left-right, d front-back):\n${f}\n\nENVIRONMENT KEYS (for the top-level environment):\n${e}`;
}
