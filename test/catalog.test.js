import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materials, furniture, environments, MATERIAL_KEYS, FURNITURE_KEYS, ENVIRONMENT_KEYS, footprintBox, describeCatalog } from '../src/viewer/catalog.js';
import { loadSchema, loadPrompt, runHarness } from '../src/harness.js';
import { validateSchema, checkLayout, checkFurniture, formatErrors } from '../src/validate.js';
import { fixture, clone, samplePhotos, createMockCallers } from '../fixtures/helpers.js';

const has = (errors, text) => assert.ok(formatErrors(errors).some((e) => e.includes(text)), `expected "${text}" in:\n${formatErrors(errors).join('\n')}`);

test('the catalog has exactly the keys in the brief, and the layout schema enums match it', async () => {
  assert.deepEqual(MATERIAL_KEYS, ['walnut', 'white_oak', 'terrazzo', 'board_concrete', 'marble_viola', 'marble_white', 'plaster', 'limestone', 'redwood_deck', 'tile_white', 'carpet_wool', 'painted_brick', 'cladding_dark']);
  assert.deepEqual(FURNITURE_KEYS, ['sofa_l', 'sofa_straight', 'lounge_chair', 'ottoman', 'coffee_table_plinth', 'dining_table', 'dining_chair', 'island_waterfall', 'counter_run', 'bar_stool', 'bed_king', 'bed_queen', 'nightstand', 'bench', 'credenza', 'bookshelf_wall', 'fireplace_concrete', 'tub_freestanding', 'vanity_double', 'desk', 'rug', 'plant_tree', 'plant_small', 'pendant_globe', 'floor_lamp', 'table_lamp']);
  assert.deepEqual(ENVIRONMENT_KEYS, ['bay_view', 'city_view', 'garden', 'forest', 'neutral_sky']);
  const schema = await loadSchema('layout');
  assert.deepEqual(schema.$defs.material.enum, MATERIAL_KEYS);
  assert.deepEqual(schema.$defs.furnitureKey.enum, FURNITURE_KEYS);
  assert.deepEqual(schema.$defs.environment.enum, ENVIRONMENT_KEYS);
  assert.ok(schema.required.includes('furniture') && schema.required.includes('environment'));
  assert.deepEqual(schema.properties.rooms.items.properties.floor, { $ref: '#/$defs/material' });
  assert.deepEqual(schema.properties.rooms.items.properties.ceiling, { $ref: '#/$defs/material' });
  for (const k of FURNITURE_KEYS) {
    const f = furniture[k].footprint;
    assert.ok(f.w > 0 && f.d > 0 && f.h > 0 && f.w < 4 && f.d < 4 && f.h < 3, `${k} has real-world sizes`);
    assert.ok(['floor', 'rug', 'hanging', 'tabletop'].includes(furniture[k].zone), k);
  }
  for (const k of MATERIAL_KEYS) assert.ok(materials[k].tile > 0 && materials[k].description.length > 5, k);
  for (const k of ENVIRONMENT_KEYS) assert.ok(environments[k].description.length > 5, k);
});

test('unknown material, furniture and environment keys fail with the valid keys listed (schema and plan check)', async () => {
  const spec = await fixture('spec');
  const schema = await loadSchema('layout');
  const layout = clone(await fixture('layout'));
  layout.rooms[0].floor = 'oak';
  layout.rooms[1].ceiling = 'popcorn';
  layout.furniture[1].item = 'couch';
  layout.furniture[4].material = 'gold';
  layout.environment = 'moon';
  const schemaErrors = formatErrors(validateSchema(schema, layout));
  assert.ok(schemaErrors.some((e) => e.startsWith('$.rooms[0].floor: must be one of "walnut", "white_oak"')), schemaErrors.join('\n'));
  assert.ok(schemaErrors.some((e) => e.startsWith('$.rooms[1].ceiling: must be one of "walnut"')), schemaErrors.join('\n'));
  assert.ok(schemaErrors.some((e) => e.startsWith('$.furniture[1].item: must be one of "sofa_l", "sofa_straight"') && e.includes('"table_lamp"')), schemaErrors.join('\n'));
  assert.ok(schemaErrors.some((e) => e.startsWith('$.furniture[4].material: must be one of "walnut"')), schemaErrors.join('\n'));
  assert.ok(schemaErrors.some((e) => e.startsWith('$.environment: must be one of "bay_view", "city_view", "garden", "forest", "neutral_sky"')), schemaErrors.join('\n'));
  const e = checkLayout(layout, spec);
  has(e, `floor material "oak" is not a catalog key; valid keys: ${MATERIAL_KEYS.join(', ')}`);
  has(e, `ceiling material "popcorn" is not a catalog key; valid keys: ${MATERIAL_KEYS.join(', ')}`);
  has(e, `furniture "couch" is not a catalog key; valid keys: ${FURNITURE_KEYS.join(', ')}`);
  has(e, `material "gold" is not a catalog key; valid keys: ${MATERIAL_KEYS.join(', ')}`);
  has(e, `environment "moon" is not a catalog key; valid keys: ${ENVIRONMENT_KEYS.join(', ')}`);
  const missing = clone(await fixture('layout'));
  delete missing.furniture; delete missing.environment;
  const m = formatErrors(validateSchema(schema, missing));
  assert.ok(m.some((x) => x.includes('missing required property "furniture"')) && m.some((x) => x.includes('missing required property "environment"')));
});

test('furniture must sit inside its room rectangle (rotation taken into account)', async () => {
  const spec = await fixture('spec');
  const layout = clone(await fixture('layout'));
  const sofa = layout.furniture.find((f) => f.id === 'f_sofa');
  sofa.x = 5.0; // 2.2 m wide, living room ends at x = 5.5
  has(checkLayout(layout, spec), '"f_sofa" (sofa_straight, 2.20 x 0.90 m at 5,3.3) does not sit inside room "living" (x 0..5.5, z 0..4.5)');
  const layout2 = clone(await fixture('layout'));
  const console_ = layout2.furniture.find((f) => f.id === 'f_console'); // 1.8 x 0.45, rotated 270 -> 0.45 x 1.8
  console_.z = 8.5; // 1.8 m deep after rotation, hall ends at z = 9
  has(checkLayout(layout2, spec), '"f_console" (credenza, 0.45 x 1.80 m at 2.75,8.5) does not sit inside room "hall"');
  console_.z = 8.0; console_.rotation = 0; // 1.8 m wide at x 2.75 runs past the hall's east wall (x = 3)
  has(checkLayout(layout2, spec), '"f_console" (credenza, 1.80 x 0.45 m at 2.75,8) does not sit inside room "hall"');
  const layout3 = clone(await fixture('layout'));
  layout3.furniture[0].room = 'garage';
  has(checkLayout(layout3, spec), 'unknown room "garage"');
  layout3.furniture.push({ ...layout3.furniture[1], id: layout3.furniture[1].id });
  has(checkLayout(layout3, spec), 'duplicate furniture id');
  assert.deepEqual(footprintBox('credenza', 1, 1, 90), { x0: 0.775, x1: 1.225, z0: 0.1, z1: 1.9, w: 0.45, d: 1.8, area: 0.81 });
  assert.equal(footprintBox('nope', 0, 0), null);
});

test('floor-standing furniture may overlap by at most 20% of the smaller footprint; rugs, pendants and tabletop items are free', async () => {
  const spec = await fixture('spec');
  assert.deepEqual(checkLayout(await fixture('layout'), spec), [], 'the recorded layout (rug under sofa, lamps on nightstands, pendants over the island) is clean');
  const layout = clone(await fixture('layout'));
  layout.furniture.find((f) => f.id === 'f_chair_w').x = 2.6; layout.furniture.find((f) => f.id === 'f_chair_w').z = 3.3; // chair dropped onto the sofa
  has(checkLayout(layout, spec), '"f_chair_w" overlaps "f_sofa" by 100% of the smaller footprint (max 20%)');
  const rooms = { r: { rect: { x: 0, z: 0, w: 10, d: 10 } } };
  const stool = (id, x) => ({ id, room: 'r', item: 'bar_stool', x, z: 5, rotation: 0 }); // 0.4 x 0.4
  assert.deepEqual(checkFurniture([stool('a', 5), stool('b', 5.34)], rooms), [], '15% overlap passes');
  has(checkFurniture([stool('a', 5), stool('b', 5.3)], rooms), '"b" overlaps "a" by 25% of the smaller footprint');
  assert.deepEqual(checkFurniture([
    { id: 'sofa', room: 'r', item: 'sofa_straight', x: 5, z: 5, rotation: 0 },
    { id: 'rug', room: 'r', item: 'rug', x: 5, z: 5, rotation: 0 },
    { id: 'pendant', room: 'r', item: 'pendant_globe', x: 5, z: 5, rotation: 0 },
    { id: 'lamp', room: 'r', item: 'table_lamp', x: 5, z: 5, rotation: 0 },
    { id: 'plant', room: 'r', item: 'plant_small', x: 5, z: 5, rotation: 0 },
  ], rooms), []);
  // the overlap check also understands rotation: a 2.0 x 0.95 table turned 90° is 0.95 x 2.0
  has(checkFurniture([
    { id: 't', room: 'r', item: 'dining_table', x: 5, z: 5, rotation: 90 }, // z 4..6
    { id: 'c', room: 'r', item: 'dining_chair', x: 5, z: 5.9, rotation: 0 }, // z 5.64..6.16
  ], rooms), '"c" overlaps "t" by 69%');
  assert.deepEqual(checkFurniture([
    { id: 't', room: 'r', item: 'dining_table', x: 5, z: 5, rotation: 0 }, // z 4.525..5.475
    { id: 'c', room: 'r', item: 'dining_chair', x: 5, z: 5.9, rotation: 0 },
  ], rooms), []);
});

test('the layout prompt hands Argon the catalog keys and asks for the furniture it sees', async () => {
  const text = describeCatalog();
  for (const k of [...MATERIAL_KEYS, ...FURNITURE_KEYS, ...ENVIRONMENT_KEYS]) assert.ok(text.includes(`- ${k}:`), k);
  const p = await loadPrompt('layout');
  assert.ok(p.system.includes('{{CATALOG}}'));
  assert.ok(/counts must match spec\.json `objects`/i.test(p.system));
  assert.ok(/you actually SEE/.test(p.system));
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const state = await runHarness({ photos, ...mock });
  const call = mock.calls.find((c) => c.meta.step === 'layout');
  for (const k of [...MATERIAL_KEYS, ...FURNITURE_KEYS, ...ENVIRONMENT_KEYS]) assert.ok(call.system.includes(`- ${k}:`), `filled prompt lists ${k}`);
  assert.ok(!call.system.includes('{{'));
  assert.equal(state.outputs.layout.environment, 'bay_view');
  assert.equal(state.outputs.layout.furniture.length, 27);
  // the recorded furniture matches the recorded spec counts for every object that has a catalog item
  const perRoom = {};
  for (const f of state.outputs.layout.furniture) perRoom[f.room] = (perRoom[f.room] || 0) + 1;
  const expected = {};
  for (const o of state.outputs.spec.objects) if (o.name !== 'mirror' && o.name !== 'basin') expected[o.room] = (expected[o.room] || 0) + o.count;
  expected.bath += 1; // basin -> vanity_double
  assert.deepEqual(perRoom, expected);
});
