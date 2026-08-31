/**
 * localStorage adapter.
 *
 * The interface is async even though localStorage is synchronous. That is deliberate:
 * every call site is written against a Promise API from day one, so swapping in
 * IndexedDB later is a new file here and nothing else (CLAUDE.md §7).
 *
 * Nothing outside src/storage/ may touch localStorage directly.
 */

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Synchronous write, for the pagehide path where a Promise may not resolve in time. */
  setSync(key: string, value: string): void;
  readonly available: boolean;
}

function probe(): boolean {
  try {
    const k = "alts-academy:probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    // Private browsing, disabled storage, or a full quota. The app must still run —
    // it just cannot remember anything, and the UI says so.
    return false;
  }
}

export function createLocalStorageAdapter(): StorageAdapter {
  const available = typeof window !== "undefined" && probe();

  return {
    available,

    async get(key) {
      if (!available) return null;
      return window.localStorage.getItem(key);
    },

    async set(key, value) {
      if (!available) return;
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        // Almost always QuotaExceededError. Losing a write is bad; crashing
        // mid-session is worse.
        console.error("[storage] write failed", err);
      }
    },

    async remove(key) {
      if (!available) return;
      window.localStorage.removeItem(key);
    },

    setSync(key, value) {
      if (!available) return;
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        console.error("[storage] sync write failed", err);
      }
    },
  };
}

/** In-memory adapter for tests, so storage logic is testable without a DOM. */
export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    available: true,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    setSync(key, value) {
      map.set(key, value);
    },
  };
}
