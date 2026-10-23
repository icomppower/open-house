import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, checkLayout, checkJudge, checkNarration, formatErrors } from '../src/validate.js';
import { fixture, clone } from './helpers.js';

const PHOTO_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const has = (errors, text) => assert.ok(formatErrors(errors).some((e) => e.includes(text)), `expected "${text}" in:\n${formatErrors(errors).join('\n')}`);

test('recorded spec and layout pass the plan checks', async () => {
  const spec = await fixture('spec');
  const layout = await fixture('layout');
  assert.deepEqual(checkSpec(spec, PHOTO_IDS), []);
  assert.deepEqual(checkLayout(layout, spec), []);
  assert.deepEqual(checkNarration(await fixture('narration'), spec), []);
});

test('spec: every photo must be mapped, rooms and materials must exist', async () => {
  const spec = clone(await fixture('spec'));
  spec.photos.pop();
  has(checkSpec(spec, PHOTO_IDS), 'photo "p6" is not mapped');
  const spec2 = clone(await fixture('spec'));
  spec2.photos[0].room = 'attic';
  spec2.rooms[0].floor = 'marble';
  spec2.objects[0].room = 'garage';
  const e = checkSpec(spec2, PHOTO_IDS);
  has(e, 'unknown room "attic"');
  has(e, 'material "marble" is not declared');
  has(e, 'unknown room "garage"');
  const spec3 = clone(await fixture('spec'));
  spec3.photos.push({ id: 'p9', room: 'living', view: 'x' });
  has(checkSpec(spec3, PHOTO_IDS), 'unknown photo "p9"');
});

test('layout: rooms must fit the footprint and not overlap', async () => {
  const spec = await fixture('spec');
  const layout = clone(await fixture('layout'));
  layout.rooms[1].rect.w = 6; // kitchen now runs past the footprint and into nothing
  has(checkLayout(layout, spec), 'does not fit inside the footprint');
  const layout2 = clone(await fixture('layout'));
  layout2.rooms[1].rect.x = 4; // kitchen slides over the living room
  has(checkLayout(layout2, spec), 'overlap on level "ground"');
  const layout3 = clone(await fixture('layout'));
  layout3.rooms.pop(); // bathroom missing
  has(checkLayout(layout3, spec), 'spec room "bath" has no rectangle');
});

test('layout: every camera must be inside its room and match the photo map', async () => {
  const spec = await fixture('spec');
  const layout = clone(await fixture('layout'));
  layout.cameras[0].position.x = 7; // p1 camera wanders into the kitchen
  has(checkLayout(layout, spec), 'camera for "p1" is outside room "living"');
  const layout2 = clone(await fixture('layout'));
  layout2.cameras[4].position.y = 1.5; // bedroom camera below the upper floor
  has(checkLayout(layout2, spec), 'not between floor (2.9) and ceiling');
  const layout3 = clone(await fixture('layout'));
  layout3.cameras[2].room = 'living';
  has(checkLayout(layout3, spec), 'spec maps that photo to "kitchen"');
  const layout4 = clone(await fixture('layout'));
  layout4.cameras.push(clone(layout4.cameras[0]));
  has(checkLayout(layout4, spec), 'photo "p1" has 2 cameras');
  const layout5 = clone(await fixture('layout'));
  layout5.cameras.pop();
  has(checkLayout(layout5, spec), 'photo "p6" has 0 cameras');
});

test('layout: material names must be consistent with the spec', async () => {
  const spec = await fixture('spec');
  const layout = clone(await fixture('layout'));
  layout.rooms[0].floor = 'oak';
  layout.rooms[2].walls = 'paint';
  const e = checkLayout(layout, spec);
  has(e, 'floor material "oak" is not in spec.materials');
  has(e, 'wall material "paint" is not in spec.materials');
});

test('layout: openings must sit on shared walls, exterior openings must face outside', async () => {
  const spec = await fixture('spec');
  const layout = clone(await fixture('layout'));
  const op = layout.openings.find((o) => o.id === 'op_living_kitchen');
  op.wall = 'n'; // kitchen is not north of the living room
  has(checkLayout(layout, spec), '"kitchen" is not on the n side of "living"');
  const layout2 = clone(await fixture('layout'));
  const win = layout2.openings.find((o) => o.id === 'win_kitchen');
  win.wall = 'w'; // the living room is on the other side of the kitchen's west wall
  has(checkLayout(layout2, spec), 'marked exterior but room "living" is on the other side');
  const layout3 = clone(await fixture('layout'));
  const door = layout3.openings.find((o) => o.id === 'door_living_hall');
  door.offset = 2.8; // hall only spans x 0..3 on that wall
  has(checkLayout(layout3, spec), 'not within the wall shared by "living" and "hall"');
  const layout4 = clone(await fixture('layout'));
  layout4.openings.find((o) => o.id === 'win_study').width = 9;
  has(checkLayout(layout4, spec), 'runs past the');
  const layout5 = clone(await fixture('layout'));
  layout5.adjacency = layout5.adjacency.filter(([a, b]) => !(a === 'living' && b === 'kitchen'));
  has(checkLayout(layout5, spec), 'adjacency does not list them');
  const layout6 = clone(await fixture('layout'));
  layout6.adjacency.push(['living', 'bath']);
  has(checkLayout(layout6, spec), 'share no wall and no stair');
});

test('judge and narration consistency checks', async () => {
  const spec = await fixture('spec');
  const v = clone((await fixture('judge')).p1[0]);
  assert.deepEqual(checkJudge(v, 'p1'), []);
  has(checkJudge(v, 'p2'), 'must be "p2"');
  v.overall = 3;
  has(checkJudge(v, 'p1'), 'verdict must be "redo"');
  const n = clone(await fixture('narration'));
  n.lines.pop();
  n.lines.push({ room: 'living', text: 'A second line for the living room, which is one too many.' });
  const e = checkNarration(n, spec);
  has(e, 'room "bath" needs exactly one line, has 0');
  has(e, 'room "living" needs exactly one line, has 2');
});
