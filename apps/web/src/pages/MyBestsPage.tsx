import { useEffect, useState } from 'react';
import { Medal } from 'lucide-react';
import { CARS, TRACKS } from '@ghost-racer/content';
import { getMyBests } from '../api/runs';
import type { PersonalBest } from '@ghost-racer/contracts';
import './MyBestsPage.css';

export function MyBestsPage() {
  const [runs, setRuns] = useState<PersonalBest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void getMyBests().then((bests) => { if (current) setRuns(bests); }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : 'Could not load your personal bests.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  return <section className="my-bests-page">
    <header><p className="race-kicker">SOLO RECORDS</p><h1>My Bests</h1><p>Your fastest verified run for each track and car.</p></header>
    {loading ? <p className="my-bests-message">Loading personal bests…</p>
      : error ? <p className="my-bests-message my-bests-error" role="alert">{error}</p>
      : runs.length === 0 ? <p className="my-bests-message">No personal bests yet. Finish a solo race to set your first record.</p>
      : <div className="my-bests-list">{runs.map((run) => {
        const track = TRACKS.find((item) => item.id === run.trackId);
        const car = CARS.find((item) => item.id === run.carId);
        return <article className="my-best-card" key={run.runId}>
          <div><span>TRACK</span><strong>{track?.name ?? run.trackId}</strong></div>
          <div><span>CAR</span><strong>{car?.name ?? run.carId}</strong></div>
          <div className="my-best-time"><span>BEST TIME</span><strong><Medal size={17} />{run.verifiedFinishTime.toFixed(2)}s</strong></div>
          {run.outdated && <p className="my-best-outdated">Set under older race rules and no longer ranked. Finish a new run on this track and car to replace it.</p>}
        </article>;
      })}</div>}
  </section>;
}
