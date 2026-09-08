// Picker options shared by the home page and local mode.
import { SETUP_MOVE_OPTIONS, type SetupMoves } from '@lose-at-chess/protocol';

export const SETUP_MOVE_CHOICES: { value: SetupMoves; label: string }[] = SETUP_MOVE_OPTIONS.map((value) => ({
  value,
  label: `${value} moves`,
}));

export const TIMER_CHOICES: { value: boolean; label: string }[] = [
  { value: false, label: 'Untimed' },
  { value: true, label: '30s per move' },
];

export function describeSettings(setupMoves: number, timed: boolean): string {
  return `${setupMoves} moves each, ${timed ? '30s per move' : 'untimed'}`;
}
