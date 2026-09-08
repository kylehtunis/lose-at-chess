// Values shared by the client and the server. Anything that affects engine
// determinism lives here so every client searches under identical conditions.

export const PROTOCOL_VERSION = 2;

// Engine search settings. Depth-limited only: movetime or node limits would make
// results depend on hardware speed and break engine-phase verification.
export const SEARCH_DEPTH = 15;
export const ENGINE_HASH_MB = 16;
export const ENGINE_THREADS = 1;

// Time allowed for each setup move in a timed game.
export const MOVE_CLOCK_MS = 30_000;

// How long a dropped player's seat is held before they forfeit (during the
// setup phase), their invite expires (while waiting), or they count as gone
// (after the game, which withdraws any rematch offer).
export const RECONNECT_WINDOW_MS = 30_000;

// Grace period for a client that drops during the engine phase while its
// opponent has already reported. Short, because the game is over bar the
// result: it only exists so a brief network drop still ends in a game
// verified by both clients rather than by one report.
export const ENGINE_RECONNECT_GRACE_MS = 5_000;

// An unclaimed invite is discarded after this long.
export const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// A finished game is kept while a player is still connected, plus this long
// after the last one leaves, so a rematch offer survives a page refresh.
export const FINISHED_GAME_RETENTION_MS = 60_000;
