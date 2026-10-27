export const CONTENT_VERSION = '1.0.0' as const;
export interface Point { readonly x: number; readonly y: number }
export interface Line { readonly start: Point; readonly end: Point }
export interface TrackDefinition { readonly id: string; readonly name: string; readonly tutorial: boolean; readonly boundary: readonly Point[]; readonly start: { readonly position: Point; readonly headingRadians: number }; readonly checkpoints: readonly Line[]; readonly finishLine: Line }
export interface CarDefinition { readonly id: string; readonly name: string; readonly description: string; readonly acceleration: number; readonly topSpeed: number; readonly handling: number; readonly offTrackPenaltyFactor: number }
const p = (x: number, y: number): Point => ({ x, y });
export const TRACKS = [
  { id: 'training_oval', name: 'Training Oval', tutorial: true, boundary: [p(-520,-300),p(-300,-440),p(300,-440),p(520,-300),p(520,300),p(300,440),p(-300,440),p(-520,300)], start: { position: p(-410,0), headingRadians: Math.PI / 2 }, checkpoints: [{start:p(0,-440),end:p(0,-250)},{start:p(520,0),end:p(310,0)},{start:p(0,440),end:p(0,250)}], finishLine: {start:p(-520,0),end:p(-310,0)} },
  { id: 'harbor_sprint', name: 'Harbor Sprint', tutorial: false, boundary: [p(-600,-400),p(500,-400),p(620,-160),p(350,40),p(620,260),p(420,430),p(-540,430),p(-650,150)], start: { position: p(-500,0), headingRadians: 0 }, checkpoints: [{start:p(400,-300),end:p(300,-120)},{start:p(500,250),end:p(330,180)},{start:p(-100,430),end:p(-100,220)}], finishLine: {start:p(-600,0),end:p(-400,0)} },
  { id: 'grand_prix_circuit', name: 'Grand Prix Circuit', tutorial: false, boundary: [p(-700,-420),p(-120,-500),p(500,-370),p(670,-80),p(480,90),p(650,370),p(150,500),p(-300,350),p(-620,430),p(-760,80)], start: { position: p(-610,-90), headingRadians: Math.PI / 2 }, checkpoints: [{start:p(0,-450),end:p(0,-280)},{start:p(580,-140),end:p(380,-80)},{start:p(480,390),end:p(300,220)},{start:p(-300,360),end:p(-280,150)}], finishLine: {start:p(-700,-90),end:p(-500,-40)} },
] as const satisfies readonly TrackDefinition[];
export const CARS = [
  { id: 'sprinter_01', name: 'Sprinter 01', description: 'High acceleration, easy recovery.', acceleration: 8.5, topSpeed: 6, handling: 7, offTrackPenaltyFactor: 0.4 },
  { id: 'cruiser_02', name: 'Cruiser 02', description: 'High top speed, severely penalized off-track.', acceleration: 5, topSpeed: 9, handling: 5.5, offTrackPenaltyFactor: 0.25 },
  { id: 'phantom_03', name: 'Phantom 03', description: 'Exceptional grip, minimal off-track penalty.', acceleration: 6.5, topSpeed: 7, handling: 8.5, offTrackPenaltyFactor: 0.5 },
] as const satisfies readonly CarDefinition[];
export const TUTORIAL_TRACK_ID = 'training_oval' as const;
export const getTrack = (id: string) => TRACKS.find((track) => track.id === id);
export const getCar = (id: string) => CARS.find((car) => car.id === id);
