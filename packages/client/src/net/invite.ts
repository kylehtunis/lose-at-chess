import type { CreateInviteRequest, CreateInviteResponse, GameSettings } from '@lose-at-chess/protocol';
import { getClientToken } from './token';

// Creates a game with this browser seated and returns its id, which is also
// the invite code.
export async function createInvite(settings: GameSettings): Promise<string> {
  const body: CreateInviteRequest = { token: getClientToken(), settings };
  const response = await fetch('/api/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Could not create the invite (server responded ${response.status})`);
  const { gameId } = (await response.json()) as CreateInviteResponse;
  return gameId;
}

export function inviteUrl(gameId: string): string {
  return `${location.origin}/invite/${gameId}`;
}
