// Short, URL-safe game ids. Ambiguous characters (0/O, 1/I/l) are excluded
// because the id doubles as the invite code people may read aloud.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 10;

export const GAME_ID_PATTERN = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);

export function newGameId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}
