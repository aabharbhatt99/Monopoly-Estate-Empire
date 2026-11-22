/**
 * Tiny in-memory router. (A published artifact only passes plain `#name` hashes, so paths like
 * `#/room/ABCDE` are not used.) The current room is remembered so a reload or a republish returns to it.
 */
const KEY = 'ee.route';
type Listener = () => void;
const listeners = new Set<Listener>();

function initial(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.startsWith('/room/')) return saved;
  } catch {
    /* ignore */
  }
  return '/';
}

let current = initial();

export function currentPath() {
  return current;
}

export function navigate(path: string) {
  current = path.startsWith('/') ? path : `/${path}`;
  try {
    localStorage.setItem(KEY, current.startsWith('/room/') ? current : '/');
  } catch {
    /* ignore */
  }
  for (const l of [...listeners]) l();
}

export function subscribeNav(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
