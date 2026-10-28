import type { CarDefinition, Line, Point, TrackDefinition } from '@ghost-racer/content';
export const SIMULATION_VERSION = '1.1.0' as const;
export const RACE_COUNTDOWN_SECONDS = 3;
export const TICK_RATE = 60; export const TICK_SECONDS = 1 / TICK_RATE; export const RACE_TIME_LIMIT_TICKS = 10_800;
export interface RaceState { tick: number; position: Point; headingRadians: number; velocity: number; checkpointIndex: number; raceComplete: boolean; timeout: boolean; finishTick?: number; offTrack: boolean }
export interface RaceInput { steer: -1 | 0 | 1; accelerate: boolean; brake: boolean }
export const EMPTY_INPUT: RaceInput = { steer: 0, accelerate: false, brake: false };
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function createRaceState(track: TrackDefinition): RaceState { return { tick: 0, position: { ...track.start.position }, headingRadians: track.start.headingRadians, velocity: 0, checkpointIndex: 0, raceComplete: false, timeout: false, offTrack: !isOnTrack(track.start.position, track) }; }
export function step(state: RaceState, input: RaceInput, track: TrackDefinition, car: CarDefinition): RaceState {
  if (state.raceComplete || state.timeout) return state;
  const offTrack = !isOnTrack(state.position, track); const factor = offTrack ? car.offTrackPenaltyFactor : 1;
  const maxSpeed = car.topSpeed * 15 * factor; const acceleration = car.acceleration * 8 * factor; const drag = acceleration / maxSpeed;
  let velocity = state.velocity;
  if (input.brake) velocity = velocity > 0 ? Math.max(0, velocity - (120 + drag * velocity) * TICK_SECONDS) : Math.max(-30, velocity - acceleration * .35 * TICK_SECONDS);
  else if (input.accelerate) velocity = Math.min(maxSpeed, velocity + (acceleration - drag * velocity) * TICK_SECONDS);
  else velocity = velocity > 0 ? Math.max(0, velocity - drag * velocity * TICK_SECONDS) : Math.min(0, velocity - drag * velocity * TICK_SECONDS);
  const turn = car.handling * 25 * Math.PI / 180 * clamp(Math.abs(velocity) / maxSpeed, .1, 1);
  const headingRadians = round(state.headingRadians + input.steer * turn * TICK_SECONDS);
  const position = { x: round(state.position.x + Math.cos(headingRadians) * velocity * TICK_SECONDS), y: round(state.position.y + Math.sin(headingRadians) * velocity * TICK_SECONDS) };
  let checkpointIndex = state.checkpointIndex;
  if (checkpointIndex < track.checkpoints.length && crossesForward(state.position, position, track.checkpoints[checkpointIndex]!)) checkpointIndex++;
  const tick = state.tick + 1; const raceComplete = checkpointIndex === track.checkpoints.length && crossesForward(state.position, position, track.finishLine);
  return { tick, position, headingRadians, velocity: round(velocity), checkpointIndex, raceComplete, timeout: !raceComplete && tick >= RACE_TIME_LIMIT_TICKS, finishTick: raceComplete ? tick : undefined, offTrack };
}
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean { let inside = false; for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) { const a=polygon[i]!,b=polygon[j]!; if (((a.y>point.y)!==(b.y>point.y)) && point.x < (b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside; } return inside; }
export function isOnTrack(point: Point, track: TrackDefinition): boolean { return pointInPolygon(point, track.boundary) && !pointInPolygon(point, track.innerBoundary); }
export function segmentsIntersect(a: Point,b: Point,line: Line): boolean { const cross=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x); const d1=cross(a,b,line.start),d2=cross(a,b,line.end),d3=cross(line.start,line.end,a),d4=cross(line.start,line.end,b); return ((d1===0||d2===0||Math.sign(d1)!==Math.sign(d2)) && (d3===0||d4===0||Math.sign(d3)!==Math.sign(d4))); }
// Gate lines run from the outer road edge to the inner road edge and races run clockwise; a gate only counts when crossed in the forward direction.
export function crossesForward(from: Point, to: Point, line: Line): boolean { return segmentsIntersect(from, to, line) && (line.end.x - line.start.x) * (to.y - from.y) - (line.end.y - line.start.y) * (to.x - from.x) < 0; }
