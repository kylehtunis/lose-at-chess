export const SETUP_MOVE_OPTIONS = [10, 25] as const;
export type SetupMoves = (typeof SETUP_MOVE_OPTIONS)[number];

export interface GameSettings {
  setupMoves: SetupMoves;
  timed: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { setupMoves: 10, timed: false };
