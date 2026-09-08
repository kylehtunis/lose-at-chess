export const SETUP_MOVE_OPTIONS = [10, 25] as const;
export type SetupMoves = (typeof SETUP_MOVE_OPTIONS)[number];

export interface GameSettings {
  setupMoves: SetupMoves;
  timed: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { setupMoves: 10, timed: false };

// One matchmaking lobby per settings combination. The id doubles as the
// lobby's URL segment and Durable Object name.
export const LOBBY_IDS = ['10-timed', '10-untimed', '25-timed', '25-untimed'] as const;
export type LobbyId = (typeof LOBBY_IDS)[number];

export function isLobbyId(value: unknown): value is LobbyId {
  return LOBBY_IDS.includes(value as LobbyId);
}

export function lobbyIdFor(settings: GameSettings): LobbyId {
  return `${settings.setupMoves}-${settings.timed ? 'timed' : 'untimed'}`;
}

export function settingsForLobby(lobby: LobbyId): GameSettings {
  const [moves, timing] = lobby.split('-');
  return { setupMoves: Number(moves) as SetupMoves, timed: timing === 'timed' };
}

export function parseSettings(input: unknown): GameSettings | null {
  if (typeof input !== 'object' || input === null) return null;
  const { setupMoves, timed } = input as Record<string, unknown>;
  if (!SETUP_MOVE_OPTIONS.includes(setupMoves as SetupMoves)) return null;
  if (typeof timed !== 'boolean') return null;
  return { setupMoves: setupMoves as SetupMoves, timed };
}
