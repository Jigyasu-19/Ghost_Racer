import { Link, useLocation, useParams } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { CARS, TRACKS } from '@ghost-racer/content';
import { TournamentRaceResultSchema, type TournamentRaceResult } from '@ghost-racer/contracts';
import './TournamentPodiumPage.css';

interface PodiumNavigationState { result?: unknown }

export function TournamentPodiumPage() {
  const location = useLocation();
  const { tournamentId } = useParams();
  const navigationState = location.state as PodiumNavigationState | null;
  const parsed = TournamentRaceResultSchema.safeParse(navigationState?.result);
  const result: TournamentRaceResult | null = parsed.success && parsed.data.tournamentId === tournamentId ? parsed.data : null;
  const finishers = result?.players.filter((player) => player.placement !== null).sort((a, b) => a.placement! - b.placement!) ?? [];
  const podiumFinishers = finishers.filter((player) => player.placement !== null && player.placement <= 3);
  const otherFinishers = finishers.filter((player) => player.placement !== null && player.placement > 3);
  const trackName = result ? TRACKS.find((track) => track.id === result.trackId)?.name ?? result.trackId : '';

  return (
    <section className="tournament-podium-page">
      <header className="podium-heading">
        <p className="eyebrow">TOURNAMENT RESULTS</p>
        <h1>{result ? 'Race complete' : 'Result unavailable'}</h1>
        {result && <p>{trackName}</p>}
      </header>
      {!result ? <div className="podium-empty-state"><p>This tournament result is not available in this view.</p></div> : <>
        {podiumFinishers.length > 0 ? <div className="podium-layout" aria-label="Tournament podium">
          {podiumFinishers.map((player) => {
            const rank = player.placement!;
            const carName = CARS.find((car) => car.id === player.carId)?.name ?? player.carId;
            return <article className={`podium-place podium-place-${rank}`} key={player.username}>
              <p className="podium-rank">{rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</p>
              <h2>{player.username}</h2>
              <p className="podium-car">{carName}</p>
              <div className="podium-step" aria-hidden="true">{rank}</div>
            </article>;
          })}
        </div> : <div className="podium-empty-state"><p>No players finished before the race time limit.</p></div>}
        {otherFinishers.length > 0 && <section className="podium-other-finishers"><h2>Other finishers</h2><ol>{otherFinishers.map((player) => <li key={player.username}><span>{player.placement}. {player.username}</span><span>{CARS.find((car) => car.id === player.carId)?.name ?? player.carId}</span></li>)}</ol></section>}
      </>}
      <Link className="btn btn-primary podium-menu-button" to="/race"><Flag size={16} /> Back to Menu</Link>
    </section>
  );
}
