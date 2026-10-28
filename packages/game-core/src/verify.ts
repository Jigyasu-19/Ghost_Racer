import { CARS, TRACKS, type CarDefinition, type Line, type Point, type TrackDefinition } from '@ghost-racer/content';
import { RACE_TIME_LIMIT_TICKS, createRaceState, crossesForward, isOnTrack, pointInPolygon, step, type RaceState } from './index.js';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

const orientation = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const properlyCross = (a: Point, b: Point, c: Point, d: Point) => orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
const edges = (polygon: readonly Point[]): Line[] => polygon.map((start, index) => ({ start, end: polygon[(index + 1) % polygon.length]! }));
const intersects = (left: Line, right: Line) => properlyCross(left.start, left.end, right.start, right.end);
function distanceToSegment(point: Point, line: Line): number {
  const dx = line.end.x - line.start.x; const dy = line.end.y - line.start.y;
  const ratio = Math.max(0, Math.min(1, ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - line.start.x - ratio * dx, point.y - line.start.y - ratio * dy);
}
const distanceToPolygon = (point: Point, polygon: readonly Point[]) => Math.min(...edges(polygon).map((edge) => distanceToSegment(point, edge)));
const midpoint = (line: Line): Point => ({ x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 });
const gatesOf = (track: TrackDefinition): Line[] => [track.finishLine, ...track.checkpoints];

function verifyGeometry(track: TrackDefinition): void {
  const name = track.id;
  assert(track.boundary.length >= 3 && track.innerBoundary.length >= 3, `${name}: outer and inner edges required`);
  assert(track.innerBoundary.every((point) => pointInPolygon(point, track.boundary)), `${name}: inner edge must lie inside the outer edge`);
  const outer = edges(track.boundary); const inner = edges(track.innerBoundary);
  for (const [label, polygon] of [['outer', outer], ['inner', inner]] as const) {
    polygon.forEach((edge, i) => polygon.forEach((other, j) => assert(j <= i + 1 || (i === 0 && j === polygon.length - 1) || !intersects(edge, other), `${name}: ${label} edge crosses itself`)));
  }
  assert(!outer.some((edge) => inner.some((other) => intersects(edge, other))), `${name}: inner and outer edges cross`);
  assert(isOnTrack(track.start.position, track), `${name}: start must be on the road`);
  const infield = { x: track.innerBoundary.reduce((sum, point) => sum + point.x, 0) / track.innerBoundary.length, y: track.innerBoundary.reduce((sum, point) => sum + point.y, 0) / track.innerBoundary.length };
  assert(pointInPolygon(infield, track.innerBoundary) && !isOnTrack(infield, track), `${name}: infield must be off-track`);
  const gates = gatesOf(track);
  gates.forEach((gate, index) => {
    assert(isOnTrack(midpoint(gate), track), `${name}: gate ${index} midpoint must be on the road`);
    assert(distanceToPolygon(gate.start, track.boundary) < 4 && distanceToPolygon(gate.end, track.innerBoundary) < 4, `${name}: gate ${index} must run from the outer edge to the inner edge`);
    gates.forEach((other, otherIndex) => assert(otherIndex <= index || !intersects(gate, other), `${name}: gates ${index} and ${otherIndex} cross`));
  });
  const first = midpoint(track.checkpoints[0]!);
  assert(Math.cos(track.start.headingRadians) * (first.x - track.start.position.x) + Math.sin(track.start.headingRadians) * (first.y - track.start.position.y) > 0, `${name}: start must face the first checkpoint`);
}

function verifyGateDirection(track: TrackDefinition, car: CarDefinition): void {
  gatesOf(track).forEach((gate, index) => {
    const dx = gate.end.x - gate.start.x; const dy = gate.end.y - gate.start.y; const length = Math.hypot(dx, dy);
    const forward = { x: dy / length, y: -dx / length }; const mid = midpoint(gate);
    const before = { x: mid.x - forward.x * 5, y: mid.y - forward.y * 5 }; const after = { x: mid.x + forward.x * 5, y: mid.y + forward.y * 5 };
    assert(crossesForward(before, after, gate) && !crossesForward(after, before, gate), `${track.id}: gate ${index} must only count forward crossings`);
    if (index === 0) return;
    const base = createRaceState(track);
    const backwards = step({ ...base, position: after, checkpointIndex: index - 1, velocity: 0 }, { steer: 0, accelerate: false, brake: false }, track, car);
    assert(backwards.checkpointIndex === index - 1, `${track.id}: idle state must not advance a checkpoint`);
  });
}

interface Pilot { path: Point[]; index: number }
function centerline(track: TrackDefinition): Point[] {
  return track.innerBoundary.map((point) => {
    const near = track.boundary.reduce<{ distance: number; point: Point }>((best, _vertex, index) => {
      const edge = { start: track.boundary[index]!, end: track.boundary[(index + 1) % track.boundary.length]! };
      const dx = edge.end.x - edge.start.x; const dy = edge.end.y - edge.start.y;
      const ratio = Math.max(0, Math.min(1, ((point.x - edge.start.x) * dx + (point.y - edge.start.y) * dy) / (dx * dx + dy * dy)));
      const candidate = { x: edge.start.x + ratio * dx, y: edge.start.y + ratio * dy };
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      return distance < best.distance ? { distance, point: candidate } : best;
    }, { distance: Infinity, point });
    return { x: (point.x + near.point.x) / 2, y: (point.y + near.point.y) / 2 };
  });
}
function drive(track: TrackDefinition, car: CarDefinition, direction: 1 | -1, maxTicks = RACE_TIME_LIMIT_TICKS): RaceState {
  const path = centerline(track);
  let state = createRaceState(track);
  const pilot: Pilot = { path, index: path.reduce((best, point, index) => Math.hypot(point.x - state.position.x, point.y - state.position.y) < Math.hypot(path[best]!.x - state.position.x, path[best]!.y - state.position.y) ? index : best, 0) };
  for (let tick = 0; tick < maxTicks && !state.raceComplete && !state.timeout; tick++) {
    while (Math.hypot(pilot.path[pilot.index]!.x - state.position.x, pilot.path[pilot.index]!.y - state.position.y) < 70) pilot.index = (pilot.index + direction + path.length) % path.length;
    const target = pilot.path[pilot.index]!;
    let error = Math.atan2(target.y - state.position.y, target.x - state.position.x) - state.headingRadians;
    while (error > Math.PI) error -= 2 * Math.PI; while (error < -Math.PI) error += 2 * Math.PI;
    state = step(state, { steer: error > .04 ? 1 : error < -.04 ? -1 : 0, accelerate: Math.abs(error) < 1, brake: Math.abs(error) > .8 && state.velocity > 40 }, track, car);
  }
  return state;
}

for (const track of TRACKS) {
  verifyGeometry(track);
  for (const car of CARS) {
    verifyGateDirection(track, car);
    const lap = drive(track, car, 1);
    assert(lap.raceComplete && lap.checkpointIndex === track.checkpoints.length, `${track.id}/${car.id}: a clean clockwise lap must finish`);
    assert(JSON.stringify(lap) === JSON.stringify(drive(track, car, 1)), `${track.id}/${car.id}: simulation must be deterministic`);
    const reverse = drive(track, car, -1);
    assert(!reverse.raceComplete && reverse.checkpointIndex === 0, `${track.id}/${car.id}: driving the circuit backwards must not count`);
  }
  const car = CARS[0]!;
  const idle = { steer: 0, accelerate: true, brake: false } as const;
  const infield = { x: track.innerBoundary.reduce((sum, point) => sum + point.x, 0) / track.innerBoundary.length, y: track.innerBoundary.reduce((sum, point) => sum + point.y, 0) / track.innerBoundary.length };
  const onRoad = step(createRaceState(track), idle, track, car);
  const offRoad = step({ ...createRaceState(track), position: infield }, idle, track, car);
  assert(!onRoad.offTrack && offRoad.offTrack && offRoad.velocity < onRoad.velocity, `${track.id}: infield must be penalised`);
  const mid = midpoint(track.finishLine); const dx = track.finishLine.end.x - track.finishLine.start.x; const dy = track.finishLine.end.y - track.finishLine.start.y; const length = Math.hypot(dx, dy);
  const early = step({ ...createRaceState(track), position: { x: mid.x - (dy / length) * 1, y: mid.y + (dx / length) * 1 }, velocity: 120, headingRadians: Math.atan2(-dx, dy) }, { steer: 0, accelerate: false, brake: false }, track, car);
  assert(!early.raceComplete, `${track.id}: finish must not count before every checkpoint`);
}
console.log(`Game-core verification passed: ${TRACKS.length} tracks x ${CARS.length} cars.`);
