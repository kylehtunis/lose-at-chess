// Engine-phase verification. Both clients play the engine phase on their own
// machine and report what they saw; the server compares the two reports.
import type { GameResult } from './messages';

// Canonical text of a report. Any difference in moves or outcome changes it.
function reportText(moves: string[], result: GameResult): string {
  return `${moves.join(' ')}|${result.outcome}|${result.winner ?? '-'}|${result.reason}`;
}

export async function hashEngineReport(moves: string[], result: GameResult): Promise<string> {
  const bytes = new TextEncoder().encode(reportText(moves, result));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
