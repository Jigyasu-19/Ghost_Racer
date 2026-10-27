import { CARS, TRACKS, TUTORIAL_TRACK_ID } from './index.js';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
for (const track of TRACKS) { assert(track.boundary.length >= 3, `${track.id}: boundary`); assert(track.checkpoints.length >= 1, `${track.id}: checkpoints`); assert(track.start.position !== undefined, `${track.id}: start`); assert(track.finishLine !== undefined, `${track.id}: finish`); }
assert(TRACKS.filter((track) => track.tutorial).length === 1 && TRACKS.some((track) => track.id === TUTORIAL_TRACK_ID), 'tutorial');
for (const car of CARS) { assert(car.acceleration >= 1 && car.acceleration <= 10 && car.topSpeed >= 1 && car.topSpeed <= 10 && car.handling >= 1 && car.handling <= 10 && car.offTrackPenaltyFactor > 0 && car.offTrackPenaltyFactor <= 1, `${car.id}: stats`); }
console.log(`Content validation passed: ${TRACKS.length} tracks, ${CARS.length} cars.`);
