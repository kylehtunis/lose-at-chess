// Identifies this browser to the server across reconnects. No account
// behind it; losing it just means losing any game in progress.
const KEY = 'lose-at-chess:client-token';

export function getClientToken(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const token = crypto.randomUUID();
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    return crypto.randomUUID();
  }
}
