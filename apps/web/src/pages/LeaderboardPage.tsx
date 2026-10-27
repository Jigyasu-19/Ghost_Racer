import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { CARS, TRACKS } from '@ghost-racer/content';
import { getLeaderboard } from '../api/runs';
import type { LeaderboardEntry } from '@ghost-racer/contracts';
import './LeaderboardPage.css';

function initialSelection(value: string | null, options: readonly { id: string }[], fallback: string): string {
  return value !== null && options.some((option) => option.id === value) ? value : fallback;
}

export function LeaderboardPage() {
  const [searchParams] = useSearchParams();
  const [trackId, setTrackId] = useState(() => initialSelection(searchParams.get('trackId'), TRACKS, TRACKS[0]!.id));
  const [carId, setCarId] = useState(() => initialSelection(searchParams.get('carId'), CARS, CARS[0]!.id));
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const track = TRACKS.find((item) => item.id === trackId)!;
  const car = CARS.find((item) => item.id === carId)!;

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void getLeaderboard(trackId, carId).then((result) => { if (current) setEntries(result); }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : 'Could not load the leaderboard.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [trackId, carId]);

  return <section className="leaderboard-page">
    <header><p className="race-kicker">VERIFIED SOLO TIMES</p><h1><Trophy size={28} />Leaderboard</h1><p>Top 10 fastest verified runs for each track and car.</p></header>
    <div className="leaderboard-filters">
      <label>Track<select value={trackId} onChange={(event) => setTrackId(event.currentTarget.value)}>{TRACKS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Car<select value={carId} onChange={(event) => setCarId(event.currentTarget.value)}>{CARS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <p className="leaderboard-scope">{track.name} · {car.name}</p>
    {loading ? <p className="leaderboard-message">Loading leaderboard…</p>
      : error ? <p className="leaderboard-message leaderboard-error" role="alert">{error}</p>
      : entries.length === 0 ? <p className="leaderboard-message">No verified runs for this track and car yet.</p>
      : <div className="leaderboard-table-wrap"><table className="leaderboard-table"><thead><tr><th>Rank</th><th>Driver</th><th>Time</th></tr></thead><tbody>{entries.map((entry) => <tr key={`${entry.rank}-${entry.username}`}><td>{entry.rank}</td><td>{entry.username}</td><td>{entry.time.toFixed(2)}s</td></tr>)}</tbody></table></div>}
  </section>;
}
