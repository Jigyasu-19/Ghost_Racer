import { z } from 'zod';

// ── Username / Email rules ──────────────────────────────

/** 3–24 chars, alphanumeric + underscores, must start with a letter */
export const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'Username must start with a letter and contain only letters, numbers, and underscores',
  );

export const EmailSchema = z
  .string()
  .email('Invalid email address')
  .max(254, 'Email must be at most 254 characters')
  .transform((e) => e.toLowerCase().trim());

/** 8–128 chars */
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

// ── Auth request / response schemas ─────────────────────

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  /** Accept either username or email */
  identity: z.string().min(1, 'Username or email is required').max(254),
  password: PasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ── User roles ──────────────────────────────────────────

export const UserRoleSchema = z.enum(['player', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// ── Public user shape (returned by /me and in responses) ─

export const PublicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: UserRoleSchema,
  tutorialCompleted: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

// ── HTTP error envelope ─────────────────────────────────

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ── Session (server-internal, exported for type sharing) ─

export const SessionRecordSchema = z.object({
  /** Opaque session ID (or its hash) */
  sessionId: z.string(),
  userId: z.string(),
  createdAt: z.date(),
  expiresAt: z.date(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

// ── Solo run replay metadata ────────────────────────────

export const RunReplayMetadataSchema = z.object({
  trackId: z.string().min(1).max(64),
  carId: z.string().min(1).max(64),
  simulationVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
});
export type RunReplayMetadata = z.infer<typeof RunReplayMetadataSchema>;

export const ReplayInputSchema = z.object({
  tick: z.number().int().min(1).max(10_800),
  input: z.object({
    steer: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    accelerate: z.boolean(),
    brake: z.boolean(),
  }).strict(),
}).strict();
export const CompressedReplaySchema = z.object({
  simulationVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
  trackId: z.string().min(1).max(64),
  carId: z.string().min(1).max(64),
  inputs: z.array(ReplayInputSchema).min(1).max(10_800),
}).strict();
export type CompressedReplay = z.infer<typeof CompressedReplaySchema>;

export const PersonalBestSchema = z.object({
  runId: z.string().regex(/^[a-f\d]{24}$/i),
  trackId: z.string(),
  carId: z.string(),
  verifiedFinishTime: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  outdated: z.boolean(),
}).strict();
export const MyBestsResponseSchema = z.object({ runs: z.array(PersonalBestSchema) }).strict();
export type PersonalBest = z.infer<typeof PersonalBestSchema>;
export type MyBestsResponse = z.infer<typeof MyBestsResponseSchema>;

export const LeaderboardParamsSchema = z.object({ trackId: z.string().min(1).max(64), carId: z.string().min(1).max(64) }).strict();
export const LeaderboardEntrySchema = z.object({ runId: z.string().regex(/^[a-f\d]{24}$/i), rank: z.number().int().min(1).max(10), username: z.string(), time: z.number().positive() }).strict();
export const LeaderboardResponseSchema = z.object({ entries: z.array(LeaderboardEntrySchema).max(10) }).strict();
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const CreateTournamentRequestSchema = z.object({ trackId: z.string().min(1).max(64) }).strict();
export const TournamentStatusSchema = z.enum(['waiting', 'starting']);
export const TournamentLobbySchema = z.object({
  id: z.string().uuid(),
  trackId: z.string(),
  status: TournamentStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
export const CreatedTournamentSchema = TournamentLobbySchema.extend({ joinCode: z.string().regex(/^\d{4,5}$/) }).strict();
export const CreateTournamentResponseSchema = z.object({ tournament: CreatedTournamentSchema }).strict();
export const TournamentStatusResponseSchema = z.object({ tournament: TournamentLobbySchema }).strict();
export type CreateTournamentRequest = z.infer<typeof CreateTournamentRequestSchema>;
export type CreatedTournament = z.infer<typeof CreatedTournamentSchema>;
export type TournamentLobby = z.infer<typeof TournamentLobbySchema>;

export const LobbyJoinRequestSchema = z.object({ code: z.string().regex(/^\d{4,5}$/) }).strict();
export const LobbyActionRequestSchema = z.object({ lobbyId: z.string().uuid() }).strict();
export const LobbyPlayerSchema = z.object({ username: UsernameSchema, ready: z.boolean(), host: z.boolean(), carId: z.string().min(1).max(64) }).strict();
export const LobbySnapshotSchema = z.object({
  lobbyId: z.string().uuid(), trackId: z.string(), status: TournamentStatusSchema,
  players: z.array(LobbyPlayerSchema).min(1).max(6),
}).strict();
export type LobbySnapshot = z.infer<typeof LobbySnapshotSchema>;
export const TournamentCarSelectionSchema = z.object({ lobbyId: z.string().uuid(), carId: z.string().min(1).max(64) }).strict();
export const RaceInputPayloadSchema = z.object({
  lobbyId: z.string().uuid(), tick: z.number().int().min(1).max(10_800),
  input: z.object({ steer: z.union([z.literal(-1), z.literal(0), z.literal(1)]), accelerate: z.boolean(), brake: z.boolean() }).strict(),
}).strict();
export const TournamentRacePlayerSnapshotSchema = z.object({
  username: UsernameSchema, carId: z.string(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  headingRadians: z.number().finite(), velocity: z.number().finite(), checkpointIndex: z.number().int().min(0),
  raceComplete: z.boolean(), timeout: z.boolean(), finishTick: z.number().int().positive().optional(),
}).strict();
export const TournamentRaceSnapshotSchema = z.object({
  lobbyId: z.string().uuid(), trackId: z.string(), tick: z.number().int().min(0).max(10_800),
  players: z.array(TournamentRacePlayerSnapshotSchema).min(2).max(6),
}).strict();
export const TournamentRaceResultPlayerSchema = z.object({
  username: UsernameSchema, carId: z.string(), placement: z.number().int().positive().nullable(),
  finishTick: z.number().int().positive().optional(), finishTimeSeconds: z.number().positive().optional(),
  timeout: z.boolean(), checkpointIndex: z.number().int().min(0),
}).strict();
export const TournamentRaceResultSchema = z.object({
  tournamentId: z.string().uuid(), trackId: z.string(), completedAt: z.string().datetime(),
  simulationVersion: z.string().min(1).max(32), contentVersion: z.string().min(1).max(32),
  players: z.array(TournamentRaceResultPlayerSchema).min(2).max(6),
}).strict();
export type TournamentRaceSnapshot = z.infer<typeof TournamentRaceSnapshotSchema>;
export type TournamentRaceResult = z.infer<typeof TournamentRaceResultSchema>;
export const TournamentHostActiveSchema = z.object({
  id: z.string().uuid(), trackId: z.string(), status: TournamentStatusSchema,
  joinCode: z.string().regex(/^\d{4,5}$/), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  players: z.array(z.object({ username: UsernameSchema, carId: z.string(), ready: z.boolean() }).strict()).min(1).max(6),
}).strict();
export const TournamentHostHistorySchema = z.object({
  active: z.array(TournamentHostActiveSchema),
  completed: z.array(TournamentRaceResultSchema),
}).strict();
export type TournamentHostHistory = z.infer<typeof TournamentHostHistorySchema>;

// ── Socket event names (typed constants) ─────────────────

export const SocketEvents = {
  // Lobby
  LOBBY_JOIN: 'lobby:join',
  LOBBY_LEAVE: 'lobby:leave',
  LOBBY_READY: 'lobby:ready',
  LOBBY_UNREADY: 'lobby:unready',
  LOBBY_START: 'lobby:start',
  LOBBY_STATE: 'lobby:state',
  LOBBY_ERROR: 'lobby:error',
  LOBBY_PLAYER_JOINED: 'lobby:player-joined',
  LOBBY_READINESS_CHANGED: 'lobby:readiness-changed',
  LOBBY_RACE_STARTING: 'lobby:race-starting',
  LOBBY_CAR_SELECT: 'lobby:car-select',

  // Race
  RACE_INPUT: 'race:input',
  RACE_SNAPSHOT: 'race:snapshot',
  RACE_FINISH: 'race:finish',
  RACE_RESULT: 'race:result',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];
