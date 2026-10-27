import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { CARS, TRACKS } from '@ghost-racer/content';
import type { RaceInput } from '@ghost-racer/game-core';
import { TournamentRaceSnapshotSchema, type TournamentRaceSnapshot } from '@ghost-racer/contracts';
import './TournamentRaceCanvas.css';

interface TournamentRaceCanvasProps {
  trackId: string;
  snapshot: TournamentRaceSnapshot;
  onInput: (input: RaceInput) => void;
  finished: boolean;
}

const readColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const toNumber = (value: string) => Number.parseInt(value.replace('#', ''), 16);
interface PlayerSprite { body: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text }

class TournamentRaceScene extends Phaser.Scene {
  private latest?: TournamentRaceSnapshot;
  private accumulator = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly sprites = new Map<string, PlayerSprite>();
  private readonly palette = {
    surface: 0, border: 0, muted: 0, lime: 0, text: 0,
  };
  constructor(private readonly track: (typeof TRACKS)[number], private readonly onInput: (input: RaceInput) => void, private readonly isFinished: () => boolean) {
    super('TournamentRaceScene');
  }

  create(): void {
    this.palette.surface = toNumber(readColor('--bg-surface'));
    this.palette.border = toNumber(readColor('--border-default'));
    this.palette.muted = toNumber(readColor('--text-muted'));
    this.palette.lime = toNumber(readColor('--accent-lime'));
    this.palette.text = toNumber(readColor('--text-primary'));
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    const graphics = this.add.graphics();
    graphics.fillStyle(this.palette.surface, 1);
    graphics.fillPoints(this.track.boundary.map((point) => new Phaser.Math.Vector2(point.x, point.y)), true);
    graphics.lineStyle(12, this.palette.border, 1);
    graphics.strokePoints(this.track.boundary.map((point) => new Phaser.Math.Vector2(point.x, point.y)), true);
    graphics.lineStyle(2, this.palette.muted, .75);
    for (const checkpoint of this.track.checkpoints) graphics.lineBetween(checkpoint.start.x, checkpoint.start.y, checkpoint.end.x, checkpoint.end.y);
    graphics.lineStyle(8, this.palette.lime, 1);
    graphics.lineBetween(this.track.finishLine.start.x, this.track.finishLine.start.y, this.track.finishLine.end.x, this.track.finishLine.end.y);
    graphics.fillStyle(this.palette.muted, 1);
    graphics.fillCircle(this.track.start.position.x, this.track.start.position.y, 7);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.handleResize(this.scale.gameSize);
  }

  setSnapshot(snapshot: TournamentRaceSnapshot): void { this.latest = snapshot; }

  update(_time: number, deltaMs: number): void {
    if (!this.latest) return;
    if (!this.isFinished()) {
      this.accumulator += Math.min(deltaMs, 100) / 1000;
      while (this.accumulator >= 1 / 60) {
        this.onInput(this.readInput());
        this.accumulator -= 1 / 60;
      }
    }
    for (const player of this.latest.players) {
      let sprite = this.sprites.get(player.username);
      if (!sprite) {
        const car = CARS.find((candidate) => candidate.id === player.carId) ?? CARS[0]!;
        const bodyColor = car.id === 'cruiser_02' ? toNumber(readColor('--state-warning')) : car.id === 'phantom_03' ? this.palette.lime : toNumber(readColor('--accent-primary'));
        const body = this.add.rectangle(0, 0, 24, 42, bodyColor).setStrokeStyle(2, this.palette.text);
        const nose = this.add.triangle(0, -24, 0, 0, 10, 12, -10, 12, this.palette.lime);
        const container = this.add.container(player.position.x, player.position.y, [body, nose]).setDepth(3);
        const label = this.add.text(player.position.x, player.position.y + 31, player.username, { color: readColor('--text-primary'), fontFamily: 'Outfit, sans-serif', fontSize: '14px', stroke: readColor('--bg-base'), strokeThickness: 3 }).setOrigin(.5).setDepth(4);
        sprite = { body: container, label };
        this.sprites.set(player.username, sprite);
      }
      sprite.body.setPosition(player.position.x, player.position.y).setRotation(player.headingRadians + Math.PI / 2);
      sprite.label.setPosition(player.position.x, player.position.y + 31);
    }
  }

  private readInput(): RaceInput {
    const left = this.cursors.left.isDown || this.keys.A!.isDown;
    const right = this.cursors.right.isDown || this.keys.D!.isDown;
    return {
      steer: left === right ? 0 : left ? -1 : 1,
      accelerate: this.cursors.up.isDown || this.keys.W!.isDown,
      brake: this.cursors.down.isDown || this.keys.S!.isDown,
    };
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const zoom = Math.min(gameSize.width / 1100, gameSize.height / 940);
    this.cameras.main.setZoom(Math.max(zoom, .25)).centerOn(0, 0);
  }
}

export function TournamentRaceCanvas({ trackId, snapshot, onInput, finished }: TournamentRaceCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TournamentRaceScene | null>(null);
  const callbacks = useRef({ onInput, finished });
  callbacks.current = { onInput, finished };
  useEffect(() => {
    if (!host.current) return;
    const track = TRACKS.find((item) => item.id === trackId) ?? TRACKS[0]!;
    const scene = new TournamentRaceScene(track, (input) => callbacks.current.onInput(input), () => callbacks.current.finished);
    sceneRef.current = scene;
    const game = new Phaser.Game({ type: Phaser.AUTO, parent: host.current, backgroundColor: toNumber(readColor('--bg-base')), scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, render: { antialias: true, pixelArt: false }, scene });
    return () => { sceneRef.current = null; game.destroy(true); };
  }, [trackId]);
  useEffect(() => {
    const parsed = TournamentRaceSnapshotSchema.safeParse(snapshot);
    if (parsed.success) sceneRef.current?.setSnapshot(parsed.data);
  }, [snapshot]);
  return <div className="tournament-race-canvas" ref={host} aria-label="Authoritative multiplayer race" />;
}
