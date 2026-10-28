import Phaser from 'phaser';
import type { TrackDefinition } from '@ghost-racer/content';

export interface TrackPalette {
  road: number;
  infield: number;
  border: number;
  marker: number;
  finish: number;
}

const vectors = (points: readonly { x: number; y: number }[]) => points.map((point) => new Phaser.Math.Vector2(point.x, point.y));

export function drawTrack(graphics: Phaser.GameObjects.Graphics, track: TrackDefinition, palette: TrackPalette): void {
  graphics.clear();
  graphics.fillStyle(palette.road, 1);
  graphics.fillPoints(vectors(track.boundary), true);
  graphics.fillStyle(palette.infield, 1);
  graphics.fillPoints(vectors(track.innerBoundary), true);
  graphics.lineStyle(12, palette.border, 1);
  graphics.strokePoints(vectors(track.boundary), true);
  graphics.strokePoints(vectors(track.innerBoundary), true);
  graphics.lineStyle(2, palette.marker, .75);
  for (const checkpoint of track.checkpoints) graphics.lineBetween(checkpoint.start.x, checkpoint.start.y, checkpoint.end.x, checkpoint.end.y);
  graphics.lineStyle(8, palette.finish, 1);
  graphics.lineBetween(track.finishLine.start.x, track.finishLine.start.y, track.finishLine.end.x, track.finishLine.end.y);
  graphics.fillStyle(palette.marker, 1);
  graphics.fillCircle(track.start.position.x, track.start.position.y, 7);
}

export function trackBounds(track: TrackDefinition, padding = 72): { minX: number; maxX: number; minY: number; maxY: number } {
  const points = [...track.boundary, ...track.innerBoundary, track.start.position, track.finishLine.start, track.finishLine.end, ...track.checkpoints.flatMap((checkpoint) => [checkpoint.start, checkpoint.end])];
  return {
    minX: Math.min(...points.map((point) => point.x)) - padding, maxX: Math.max(...points.map((point) => point.x)) + padding,
    minY: Math.min(...points.map((point) => point.y)) - padding, maxY: Math.max(...points.map((point) => point.y)) + padding,
  };
}

export function fitTrackCamera(camera: Phaser.Cameras.Scene2D.Camera, gameSize: Phaser.Structs.Size, track: TrackDefinition): void {
  const { minX, maxX, minY, maxY } = trackBounds(track);
  const zoom = Math.min(gameSize.width / (maxX - minX), gameSize.height / (maxY - minY));
  camera.setZoom(Math.max(zoom, .1)).centerOn((minX + maxX) / 2, (minY + maxY) / 2);
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export class CountdownOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private label = '';

  constructor(scene: Phaser.Scene, track: TrackDefinition, color: number, outline: number) {
    const { minX, maxX, minY, maxY } = trackBounds(track);
    this.text = scene.add.text((minX + maxX) / 2, (minY + maxY) / 2, '', { fontFamily: 'Outfit, sans-serif', fontSize: '220px', fontStyle: '700', color: hex(color), stroke: hex(outline), strokeThickness: 12 }).setOrigin(.5).setDepth(20).setAlpha(0);
  }

  show(label: string): void {
    if (label === this.label) return;
    this.label = label;
    const scene = this.text.scene;
    scene.tweens.killTweensOf(this.text);
    this.text.setText(label).setAlpha(1).setScale(1.3);
    scene.tweens.add({ targets: this.text, scale: 1, duration: 300, ease: 'Cubic.easeOut' });
  }

  finish(): void {
    this.show('GO!');
    this.text.scene.tweens.add({ targets: this.text, alpha: 0, delay: 450, duration: 350 });
  }
}

export function playCheckpointEffect(scene: Phaser.Scene, line: { start: { x: number; y: number }; end: { x: number; y: number } }, car: Phaser.GameObjects.Container | undefined, color: number): void {
  const flash = scene.add.graphics().setDepth(2);
  flash.lineStyle(10, color, 1).lineBetween(line.start.x, line.start.y, line.end.x, line.end.y);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 500, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  if (car) scene.tweens.add({ targets: car, scale: { from: 1.3, to: 1 }, duration: 240, ease: 'Back.easeOut' });
}
