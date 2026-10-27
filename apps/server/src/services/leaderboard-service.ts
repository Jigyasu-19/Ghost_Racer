import { getCar, getTrack } from '@ghost-racer/content';
import { findTopRuns } from '../persistence/run-repository.js';
import { HttpError } from '../http/errors.js';

export async function getSoloLeaderboard(trackId: string, carId: string) {
  const track = getTrack(trackId);
  const car = getCar(carId);
  if (!track || !car) throw new HttpError(404, 'CONTENT_NOT_FOUND', 'The selected track or car does not exist.');
  return { entries: await findTopRuns(track.id, car.id) };
}
