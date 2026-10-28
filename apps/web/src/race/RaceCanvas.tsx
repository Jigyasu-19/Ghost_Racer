import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Phaser from 'phaser';
import { CARS, CONTENT_VERSION, TRACKS, TUTORIAL_TRACK_ID } from '@ghost-racer/content';
import type { CompressedReplay } from '@ghost-racer/contracts';
import { createRaceState, RACE_COUNTDOWN_SECONDS, SIMULATION_VERSION, step, TICK_SECONDS, type RaceInput, type RaceState } from '@ghost-racer/game-core';
import { CountdownOverlay, drawTrack, fitTrackCamera, playCheckpointEffect } from './track-renderer';

export interface RaceHudState { tick: number; checkpointIndex: number; checkpointCount: number; raceComplete: boolean; timeout: boolean; velocity: number; offTrack: boolean; replayAvailable: boolean }
export interface RaceCanvasHandle { playReplay: () => Promise<void>; getReplaySubmission: () => RunReplaySubmission | null }
export interface RunReplaySubmission { compressedReplay: ArrayBuffer; trackId: string; carId: string; simulationVersion: string; contentVersion: string }
export interface RaceGhostSelection { replay: CompressedReplay; appearance: 'personal' | 'public' }
interface RaceCanvasProps { trackId: string; carId: string; onUpdate: (state: RaceHudState) => void; ghostSelection?: RaceGhostSelection | null }
interface Palette { base: number; surface: number; border: number; cyan: number; lime: number; text: number; muted: number }
const cssColor = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const colorNumber = (value: string) => Number.parseInt(value.replace('#', ''), 16);
function readPalette(): Palette { return { base: colorNumber(cssColor('--bg-base', '#08080e')), surface: colorNumber(cssColor('--bg-surface', '#111119')), border: colorNumber(cssColor('--border-default', '#1e1e2e')), cyan: colorNumber(cssColor('--accent-primary', '#00e5ff')), lime: colorNumber(cssColor('--accent-lime', '#b2ff59')), text: colorNumber(cssColor('--text-primary', '#e8e8ec')), muted: colorNumber(cssColor('--text-muted', '#5c5c70')) }; }

class SoloRaceScene extends Phaser.Scene {
  private state: RaceState;
  private previousPosition: { x: number; y: number };
  private accumulator = 0;
  private countdownMs = RACE_COUNTDOWN_SECONDS * 1000;
  private countdown?: CountdownOverlay;
  private carShape?: Phaser.GameObjects.Container;
  private ghostShape?: Phaser.GameObjects.Container;
  private trackGraphics?: Phaser.GameObjects.Graphics;
  private recordedInputs: CompressedReplay['inputs'] = [];
  private ghostInputs: CompressedReplay['inputs'] = [];
  private compressedReplay?: Uint8Array;
  private replayAvailable = false;
  private replayState?: RaceState;
  private replayPreviousPosition?: { x: number; y: number };
  private replayIndex = 0;
  private replayActive = false;
  private readonly onUpdate: RaceCanvasProps['onUpdate'];
  private palette: Palette;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(onUpdate: RaceCanvasProps['onUpdate'], private readonly track: (typeof TRACKS)[number], private readonly car: (typeof CARS)[number], private readonly ghostSelection?: RaceGhostSelection | null) { super('SoloRaceScene'); this.onUpdate = onUpdate; this.palette = readPalette(); this.state = createRaceState(this.track); this.previousPosition = { ...this.track.start.position }; }

  create(): void {
    this.palette = readPalette();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.trackGraphics = this.add.graphics();
    this.drawTrack();
    const body = this.add.rectangle(0, 0, 24, 42, this.palette.cyan).setStrokeStyle(2, this.palette.text);
    const nose = this.add.triangle(0, -24, 0, 0, 10, 12, -10, 12, this.palette.lime);
    this.carShape = this.add.container(this.track.start.position.x, this.track.start.position.y, [body, nose]).setDepth(3).setRotation(this.state.headingRadians + Math.PI / 2);
    const publicGhost = this.ghostSelection?.appearance === 'public';
    const ghostColor = publicGhost ? this.palette.muted : this.palette.cyan;
    const ghostNoseColor = publicGhost ? ghostColor : this.palette.lime;
    const ghostBody = this.add.rectangle(0, 0, 24, 42, ghostColor, .45).setStrokeStyle(2, publicGhost ? ghostColor : this.palette.text, .55);
    const ghostNose = this.add.triangle(0, -24, 0, 0, 10, 12, -10, 12, ghostNoseColor, .5);
    this.ghostShape = this.add.container(this.track.start.position.x, this.track.start.position.y, [ghostBody, ghostNose]).setDepth(2).setVisible(false);
    this.countdown = new CountdownOverlay(this, this.track, this.palette.lime, this.palette.base);
    if (this.ghostSelection) this.startReplay(this.ghostSelection.replay);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.handleResize(this.scale.gameSize);
    this.emitHud();
  }

  update(_time: number, deltaMs: number): void {
    if ((this.state.raceComplete || this.state.timeout) && !this.replayActive) return;
    if (this.countdownMs > 0) {
      this.countdownMs -= Math.min(deltaMs, 100);
      if (this.countdownMs > 0) { this.countdown?.show(String(Math.ceil(this.countdownMs / 1000))); return; }
      this.countdown?.finish();
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(deltaMs, 100) / 1000;
    while (this.accumulator >= TICK_SECONDS) {
      if (!this.state.raceComplete && !this.state.timeout) {
        this.previousPosition = { ...this.state.position };
        const input = this.readInput();
        this.recordedInputs.push({ tick: this.state.tick + 1, input });
        const checkpointBefore = this.state.checkpointIndex;
        this.state = step(this.state, input, this.track, this.car);
        if (this.state.checkpointIndex > checkpointBefore) playCheckpointEffect(this, this.track.checkpoints[checkpointBefore]!, this.carShape, this.palette.lime);
        if (this.state.raceComplete || this.state.timeout) void this.compressReplay();
        this.emitHud();
      }
      if (this.replayActive && this.replayState) this.stepReplay();
      this.accumulator -= TICK_SECONDS;
    }
    const alpha = this.accumulator / TICK_SECONDS;
    const x = this.previousPosition.x + (this.state.position.x - this.previousPosition.x) * alpha;
    const y = this.previousPosition.y + (this.state.position.y - this.previousPosition.y) * alpha;
    this.carShape?.setPosition(x, y).setRotation(this.state.headingRadians + Math.PI / 2);
    if (this.replayState && this.replayPreviousPosition) {
      const ghostX = this.replayPreviousPosition.x + (this.replayState.position.x - this.replayPreviousPosition.x) * alpha;
      const ghostY = this.replayPreviousPosition.y + (this.replayState.position.y - this.replayPreviousPosition.y) * alpha;
      this.ghostShape?.setPosition(ghostX, ghostY).setRotation(this.replayState.headingRadians + Math.PI / 2);
    }
  }

  async playReplay(): Promise<void> {
    if (!this.compressedReplay) return;
    const buffer = this.compressedReplay.slice().buffer as ArrayBuffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const replay = JSON.parse(await new Response(stream).text()) as CompressedReplay;
    this.startReplay(replay);
  }

  private startReplay(replay: CompressedReplay): void {
    if (replay.simulationVersion !== SIMULATION_VERSION || replay.contentVersion !== CONTENT_VERSION || replay.trackId !== this.track.id || replay.carId !== this.car.id) return;
    if (replay.inputs.some((entry, index) => entry.tick !== index + 1)) return;
    this.ghostInputs = replay.inputs;
    this.replayState = createRaceState(this.track);
    this.replayPreviousPosition = { ...this.track.start.position };
    this.replayIndex = 0;
    this.replayActive = true;
    this.ghostShape?.setPosition(this.track.start.position.x, this.track.start.position.y).setRotation(this.replayState.headingRadians + Math.PI / 2).setVisible(true);
  }

  getReplaySubmission(): RunReplaySubmission | null {
    if (!this.compressedReplay) return null;
    return { compressedReplay: this.compressedReplay.slice().buffer as ArrayBuffer, trackId: this.track.id, carId: this.car.id, simulationVersion: SIMULATION_VERSION, contentVersion: CONTENT_VERSION };
  }

  private stepReplay(): void {
    const state = this.replayState;
    if (!state || this.replayIndex >= this.ghostInputs.length || state.raceComplete || state.timeout) { this.replayActive = false; return; }
    const entry = this.ghostInputs[this.replayIndex]!;
    if (entry.tick !== state.tick + 1) { this.replayActive = false; return; }
    this.replayPreviousPosition = { ...state.position };
    this.replayState = step(state, entry.input, this.track, this.car);
    this.replayIndex++;
    if (this.replayIndex >= this.ghostInputs.length || this.replayState.raceComplete || this.replayState.timeout) this.replayActive = false;
  }

  private async compressReplay(): Promise<void> {
    if (this.compressedReplay) return;
    try {
      const replay: CompressedReplay = { simulationVersion: SIMULATION_VERSION, contentVersion: CONTENT_VERSION, trackId: this.track.id, carId: this.car.id, inputs: this.recordedInputs };
      const stream = new Blob([JSON.stringify(replay)]).stream().pipeThrough(new CompressionStream('gzip'));
      this.compressedReplay = new Uint8Array(await new Response(stream).arrayBuffer());
      this.replayAvailable = true;
      this.emitHud();
    } catch {
      this.replayAvailable = false;
      this.emitHud();
    }
  }

  private readInput(): RaceInput {
    const keyboard = this.cursors;
    const left = keyboard.left.isDown || this.keys.A!.isDown;
    const right = keyboard.right.isDown || this.keys.D!.isDown;
    return { steer: left === right ? 0 : left ? -1 : 1, accelerate: keyboard.up.isDown || this.keys.W!.isDown, brake: keyboard.down.isDown || this.keys.S!.isDown };
  }

  private drawTrack(): void {
    drawTrack(this.trackGraphics!, this.track, { road: this.palette.surface, infield: this.palette.base, border: this.palette.border, marker: this.palette.muted, finish: this.palette.lime });
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    fitTrackCamera(this.cameras.main, gameSize, this.track);
  }

  private emitHud(): void { this.onUpdate({ tick: this.state.tick, checkpointIndex: this.state.checkpointIndex, checkpointCount: this.track.checkpoints.length, raceComplete: this.state.raceComplete, timeout: this.state.timeout, velocity: this.state.velocity, offTrack: this.state.offTrack, replayAvailable: this.replayAvailable }); }
}

export const RaceCanvas = forwardRef<RaceCanvasHandle, RaceCanvasProps>(function RaceCanvas({ trackId, carId, onUpdate, ghostSelection }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onUpdate);
  const sceneRef = useRef<SoloRaceScene | null>(null);
  callback.current = onUpdate;
  useImperativeHandle(ref, () => ({ playReplay: async () => { await sceneRef.current?.playReplay(); }, getReplaySubmission: () => sceneRef.current?.getReplaySubmission() ?? null }), []);
  useEffect(() => {
    if (!host.current) return;
    const track = TRACKS.find((item) => item.id === trackId) ?? TRACKS.find((item) => item.id === TUTORIAL_TRACK_ID)!;
    const car = CARS.find((item) => item.id === carId) ?? CARS[0]!;
    const scene = new SoloRaceScene((state) => callback.current(state), track, car, ghostSelection);
    sceneRef.current = scene;
    const game = new Phaser.Game({ type: Phaser.AUTO, parent: host.current, backgroundColor: cssColor('--bg-base', '#08080e'), scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, render: { antialias: true, pixelArt: false }, scene });
    return () => { sceneRef.current = null; game.destroy(true); };
  }, [trackId, carId, ghostSelection]);
  return <div className="race-canvas-host" ref={host} aria-label="Playable top-down race track" />;
});
