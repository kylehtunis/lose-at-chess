// Values shared by the client and the server. Anything that affects engine
// determinism lives here so every client searches under identical conditions.

export const PROTOCOL_VERSION = 1;

// Engine search settings. Depth-limited only: movetime or node limits would make
// results depend on hardware speed and break engine-phase verification.
export const SEARCH_DEPTH = 15;
export const ENGINE_HASH_MB = 16;
export const ENGINE_THREADS = 1;

export const MOVE_CLOCK_MS = 30_000;
export const RECONNECT_WINDOW_MS = 30_000;

// Grace period for a client that drops during the engine phase while its
// opponent has already reported. Short, because the game is over bar the
// result: it only exists so a brief network drop still ends in a game
// verified by both clients rather than by one report.
export const ENGINE_RECONNECT_GRACE_MS = 5_000;
