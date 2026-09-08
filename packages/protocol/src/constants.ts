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
