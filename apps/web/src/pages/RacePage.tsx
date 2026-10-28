import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag, Play, RotateCcw } from 'lucide-react';
import { CARS, CONTENT_VERSION, TRACKS, TUTORIAL_TRACK_ID } from '@ghost-racer/content';
import { SIMULATION_VERSION } from '@ghost-racer/game-core';
import type { LeaderboardEntry } from '@ghost-racer/contracts';
import { getLeaderboard, getMyBests, getReplay, submitRun } from '../api/runs';
import { useAuth } from '../auth/AuthContext';
import { RaceCanvas, type RaceCanvasHandle, type RaceGhostSelection, type RaceHudState } from '../race/RaceCanvas';
import './RacePage.css';

export function RacePage() {
  const { user, completeTutorial } = useAuth();
  const [hud, setHud] = useState<RaceHudState>({ tick: 0, checkpointIndex: 0, checkpointCount: 0, raceComplete: false, timeout: false, velocity: 0, offTrack: false, replayAvailable: false });
  const [raceKey, setRaceKey] = useState(0);
  const [tutorialStarted, setTutorialStarted] = useState(false);
  const [tutorialSave, setTutorialSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tutorialError, setTutorialError] = useState('');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(TRACKS[0]!.id);
  const [selectedCarId, setSelectedCarId] = useState<string>(CARS[0]!.id);
  const [activeRace, setActiveRace] = useState<{ trackId: string; carId: string; ghostSelection: RaceGhostSelection | null } | null>(null);
  const [personalBests, setPersonalBests] = useState<Awaited<ReturnType<typeof getMyBests>>>([]);
  const [personalBestsError, setPersonalBestsError] = useState('');
  const [publicGhosts, setPublicGhosts] = useState<LeaderboardEntry[]>([]);
  const [publicGhostsLoading, setPublicGhostsLoading] = useState(false);
  const [publicGhostsError, setPublicGhostsError] = useState('');
  const [selectedGhost, setSelectedGhost] = useState<{ runId: string; appearance: 'personal' | 'public' } | null>(null);
  const [startingRace, setStartingRace] = useState(false);
  const [raceStartError, setRaceStartError] = useState('');
  const [runSubmission, setRunSubmission] = useState<{ status: 'idle' | 'submitting' | 'new-best' | 'not-faster' | 'error'; message: string }>({ status: 'idle', message: '' });
  const raceCanvasRef = useRef<RaceCanvasHandle>(null);
  const submittedRaceKey = useRef<number | null>(null);
  const onUpdate = useCallback((next: RaceHudState) => setHud(next), []);
  const time = (hud.tick / 60).toFixed(2);
  const needsTutorial = user?.tutorialCompleted === false;
  const selectedBest = personalBests.find((run) => run.trackId === selectedTrackId && run.carId === selectedCarId);
  const outdatedBest = selectedBest?.outdated === true;

  useEffect(() => {
    if (!user || needsTutorial || activeRace !== null) return;
    let current = true;
    setPersonalBestsError('');
    void getMyBests().then((runs) => { if (current) setPersonalBests(runs); }).catch((error: unknown) => {
      if (current) setPersonalBestsError(error instanceof Error ? error.message : 'Could not load personal bests.');
    });
    return () => { current = false; };
  }, [activeRace, needsTutorial, user?.id]);

  useEffect(() => {
    if (!user || needsTutorial || activeRace !== null) return;
    let current = true;
    setPublicGhostsLoading(true);
    setPublicGhostsError('');
    setPublicGhosts([]);
    void getLeaderboard(selectedTrackId, selectedCarId).then((entries) => { if (current) setPublicGhosts(entries); }).catch((error: unknown) => {
      if (current) setPublicGhostsError(error instanceof Error ? error.message : 'Could not load public ghosts.');
    }).finally(() => { if (current) setPublicGhostsLoading(false); });
    return () => { current = false; };
  }, [activeRace, needsTutorial, selectedCarId, selectedTrackId, user?.id]);

  async function startSelectedRace(): Promise<void> {
    if (startingRace) return;
    setStartingRace(true);
    setRaceStartError('');
    try {
      const replay = selectedGhost ? await getReplay(selectedGhost.runId) : null;
      if (replay && (replay.trackId !== selectedTrackId || replay.carId !== selectedCarId)) {
        throw new Error('The selected ghost replay does not match the track and car.');
      }
      if (replay && (replay.simulationVersion !== SIMULATION_VERSION || replay.contentVersion !== CONTENT_VERSION)) {
        throw new Error('The selected ghost replay uses incompatible race rules.');
      }
      const ghostSelection = replay && selectedGhost ? { replay, appearance: selectedGhost.appearance } : null;
      setHud({ tick: 0, checkpointIndex: 0, checkpointCount: 0, raceComplete: false, timeout: false, velocity: 0, offTrack: false, replayAvailable: false });
      setRunSubmission({ status: 'idle', message: '' });
      setActiveRace({ trackId: selectedTrackId, carId: selectedCarId, ghostSelection });
      setRaceKey((key) => key + 1);
    } catch (error: unknown) {
      setRaceStartError(error instanceof Error ? error.message : 'Could not load the selected replay.');
    } finally {
      setStartingRace(false);
    }
  }

  useEffect(() => {
    if (!needsTutorial || !tutorialStarted || !hud.raceComplete || tutorialSave !== 'idle') return;
    setTutorialSave('saving');
    setTutorialError('');
    void completeTutorial().then(() => setTutorialSave('saved')).catch((error: unknown) => {
      setTutorialError(error instanceof Error ? error.message : 'Could not save tutorial completion.');
      setTutorialSave('error');
    });
  }, [completeTutorial, hud.raceComplete, needsTutorial, tutorialSave, tutorialStarted]);

  useEffect(() => {
    if (activeRace === null || needsTutorial || !hud.raceComplete || !hud.replayAvailable || submittedRaceKey.current === raceKey) return;
    const replay = raceCanvasRef.current?.getReplaySubmission();
    if (replay === null || replay === undefined) return;
    submittedRaceKey.current = raceKey;
    setRunSubmission({ status: 'submitting', message: 'Verifying run and checking your personal best…' });
    void submitRun(replay).then((result) => {
      setRunSubmission(result.newPersonalBest
        ? { status: 'new-best', message: `New personal best · ${result.verifiedFinishTime.toFixed(2)}s` }
        : { status: 'not-faster', message: `Run verified · ${result.verifiedFinishTime.toFixed(2)}s, not faster than your personal best.` });
    }).catch((error: unknown) => {
      setRunSubmission({ status: 'error', message: error instanceof Error ? error.message : 'Could not verify this run.' });
    });
  }, [activeRace, hud.raceComplete, hud.replayAvailable, needsTutorial, raceKey]);

  if (needsTutorial && !tutorialStarted) {
    return <section className="tutorial-briefing"><p className="race-kicker">FIRST RACE · TUTORIAL</p><h1>Learn the track</h1><p>Complete Training Oval by crossing every checkpoint in order, then crossing the finish line.</p><div className="tutorial-instructions"><span><kbd>W</kbd> or <kbd>↑</kbd> accelerate</span><span><kbd>S</kbd> or <kbd>↓</kbd> brake / reverse</span><span><kbd>A</kbd>/<kbd>D</kbd> or arrows steer</span></div><p className="tutorial-route">Start → upper checkpoint → right checkpoint → lower checkpoint → finish</p><button className="btn btn-primary" onClick={() => { setHud({ tick: 0, checkpointIndex: 0, checkpointCount: 0, raceComplete: false, timeout: false, velocity: 0, offTrack: false, replayAvailable: false }); setTutorialStarted(true); }}>Start Tutorial</button></section>;
  }

  if (!needsTutorial && activeRace === null) {
    return <section className="selection-page">
      <header><p className="race-kicker">RACE SETUP</p><h1>Choose your track and car</h1><p>Pick a course and a car to start a solo run.</p></header>
      <div className="selection-section"><h2>Tracks</h2><div className="selection-grid">{TRACKS.map((track) => <button key={track.id} className={`selection-card ${selectedTrackId === track.id ? 'selected' : ''}`} onClick={() => { setSelectedTrackId(track.id); setSelectedGhost(null); }}><strong>{track.name}</strong><span>{track.tutorial ? 'Tutorial track' : `${track.checkpoints.length} checkpoints`}</span></button>)}</div></div>
      <div className="selection-section"><h2>Cars</h2><div className="selection-grid">{CARS.map((car) => <button key={car.id} className={`selection-card ${selectedCarId === car.id ? 'selected' : ''}`} onClick={() => { setSelectedCarId(car.id); setSelectedGhost(null); }}><strong>{car.name}</strong><span>{car.description}</span><small>ACC {car.acceleration.toFixed(1)} · TOP {car.topSpeed.toFixed(1)} · HAND {car.handling.toFixed(1)} · OFF-TRACK {car.offTrackPenaltyFactor.toFixed(2)}×</small></button>)}</div></div>
      <fieldset className="ghost-selection"><legend>Race against a ghost</legend>
        <label><input type="radio" name="race-ghost" checked={selectedGhost === null} onChange={() => setSelectedGhost(null)} /><span>Race alone</span></label>
        {selectedBest && outdatedBest && <p className="ghost-selection-message">Your saved best used older race rules and can't be used as a ghost. Finish a run to replace it.</p>}
        {selectedBest && !outdatedBest && <label><input type="radio" name="race-ghost" checked={selectedGhost?.runId === selectedBest.runId && selectedGhost.appearance === 'personal'} onChange={() => setSelectedGhost({ runId: selectedBest.runId, appearance: 'personal' })} /><span>Your best · {selectedBest.verifiedFinishTime.toFixed(2)}s</span></label>}
        {publicGhostsLoading && <p className="ghost-selection-message">Loading top 10 ghosts…</p>}
        {publicGhostsError && <p className="tutorial-save-error" role="alert">{publicGhostsError}</p>}
        {publicGhosts.map((ghost) => <label key={ghost.runId}><input type="radio" name="race-ghost" checked={selectedGhost?.runId === ghost.runId && selectedGhost.appearance === 'public'} onChange={() => setSelectedGhost({ runId: ghost.runId, appearance: 'public' })} /><span>#{ghost.rank} · {ghost.username} · {ghost.time.toFixed(2)}s</span></label>)}
      </fieldset>
      {personalBestsError && <p className="tutorial-save-error" role="alert">{personalBestsError}</p>}{raceStartError && <p className="tutorial-save-error" role="alert">{raceStartError}</p>}
      <div className="selection-actions"><button className="btn btn-primary selection-start" disabled={startingRace} onClick={() => void startSelectedRace()}>{startingRace ? 'Loading race…' : 'Start Solo Race'}</button><Link className="btn btn-secondary" to={`/leaderboard?trackId=${encodeURIComponent(selectedTrackId)}&carId=${encodeURIComponent(selectedCarId)}`}>View Leaderboard</Link></div>
    </section>;
  }

  const race = needsTutorial ? { trackId: TUTORIAL_TRACK_ID, carId: CARS[0]!.id, ghostSelection: null } : activeRace!;
  const track = TRACKS.find((item) => item.id === race.trackId)!;
  const car = CARS.find((item) => item.id === race.carId)!;

  return <section className="race-page">
    <header className="race-heading"><div><p className="race-kicker">{needsTutorial ? 'FIRST RACE · TUTORIAL' : 'SOLO RUN'}</p><h1>{track.name}</h1></div><span className="race-car-name">{car.name}</span></header>
    <div className="race-hud" aria-live="polite">
      <div><span>TIME</span><strong>{time}s</strong></div>
      <div><span>CHECKPOINTS</span><strong>{hud.checkpointIndex}/{hud.checkpointCount}</strong></div>
      <div><span>SPEED</span><strong>{Math.abs(hud.velocity).toFixed(1)} u/s</strong></div>
      <div><span>TRACK</span><strong className={hud.offTrack ? 'race-state-offtrack' : 'race-state-ontrack'}>{hud.offTrack ? 'OFF TRACK' : 'ON TRACK'}</strong></div>
    </div>
    <div className="race-stage">
      <RaceCanvas ref={raceCanvasRef} key={`${raceKey}-${race.trackId}-${race.carId}`} trackId={race.trackId} carId={race.carId} ghostSelection={race.ghostSelection} onUpdate={onUpdate} />
      {(hud.raceComplete || hud.timeout) && <div className="race-finish" role="status"><Flag size={28} /><h2>{hud.raceComplete ? needsTutorial ? 'Tutorial complete' : 'Race Complete' : 'Time Limit Reached'}</h2><p>{hud.raceComplete ? `Finish time · ${time}s` : 'The 180 second race limit has elapsed.'}</p>{needsTutorial && hud.raceComplete ? tutorialSave === 'saving' ? <p>Saving tutorial completion…</p> : tutorialSave === 'error' ? <><p className="tutorial-save-error">{tutorialError}</p><button className="btn btn-primary" onClick={() => setTutorialSave('idle')}>Retry save</button></> : <p>Your track selection is ready.</p> : <><div className="race-finish-actions">{hud.raceComplete && hud.replayAvailable && <button className="btn btn-secondary" onClick={() => { void raceCanvasRef.current?.playReplay(); }}><Play size={16} /> Replay</button>}<button className="btn btn-primary" onClick={() => { setHud({ tick: 0, checkpointIndex: 0, checkpointCount: 0, raceComplete: false, timeout: false, velocity: 0, offTrack: false, replayAvailable: false }); setRunSubmission({ status: 'idle', message: '' }); setRaceKey((key) => key + 1); }}>{hud.timeout ? 'Try Again' : <><RotateCcw size={16} /> Race Again</>}</button>{!needsTutorial && <button className="btn btn-secondary" onClick={() => setActiveRace(null)}>Change Track / Car</button>}</div>{runSubmission.message && <p className={runSubmission.status === 'error' ? 'tutorial-save-error' : ''}>{runSubmission.message}</p>}</>}</div>}
    </div>
    <p className="race-controls">Drive with <kbd>W</kbd>/<kbd>↑</kbd> accelerate, <kbd>S</kbd>/<kbd>↓</kbd> brake or reverse, and <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> steer.</p>
  </section>;
}
