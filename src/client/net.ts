import { useEffect, useState } from 'react';
import type { RoomView } from '../engine/room';
import { RoomClient, createRoom, deleteGame, listGames, randomId, roomExists, type GameRow } from './roomClient';
import { openStore, type Store } from './store';

export type { GameRow };

/** This browser's identity. Set once by initNet(); the viewer's account id when available, so it follows them across devices. */
export let clientId = '';
/** True when the game data is shared with other people (online rooms work). */
export let sharedStorage = false;
let store: Store;

const clients = new Map<string, RoomClient>();

async function stableId(): Promise<string> {
  try {
    const user = await (globalThis as any).claude?.use?.('user');
    const id = await user?.id?.();
    if (id) return String(id);
  } catch {
    /* fall back below */
  }
  try {
    const k = 'ee.clientId';
    const existing = localStorage.getItem(k);
    if (existing) return existing;
    const v = randomId();
    localStorage.setItem(k, v);
    return v;
  } catch {
    return randomId();
  }
}

export async function initNet() {
  store = await openStore();
  sharedStorage = store.shared;
  clientId = await stableId();
}

const upper = (c: unknown) => String(c ?? '').toUpperCase().trim();

/** Same contract as the old socket call: resolves on success, rejects with a readable message. */
export async function call(event: string, payload: any): Promise<any> {
  switch (event) {
    case 'room:create': {
      if (payload.mode === 'online' && !sharedStorage) throw new Error('Online rooms need the shared game data, which is not available here.');
      return { ok: true, code: await createRoom(store, clientId, payload.mode === 'online' ? 'online' : 'local') };
    }
    case 'room:join': {
      const code = upper(payload.code);
      if (!sharedStorage) throw new Error('Joining a room needs the shared game data, which is not available here.');
      if (!(await roomExists(store, code))) throw new Error(`No room with code ${code}.`);
      return { ok: true, code };
    }
    case 'room:leave':
      return { ok: true };
    default: {
      const c = clients.get(upper(payload?.code));
      if (!c) throw new Error('Open the room first.');
      const { code: _code, ...rest } = payload ?? {};
      return c.call(event, rest);
    }
  }
}

export function useConnection() {
  return true;
}

export async function loadGames(): Promise<GameRow[]> {
  return listGames(store);
}
export async function removeGame(code: string): Promise<void> {
  return deleteGame(store, code);
}

/** Who else has this room open right now, through the `room` presence capability (when available). */
async function trackPresence(client: RoomClient): Promise<() => void> {
  try {
    const claude = (globalThis as any).claude;
    const rooms = claude?.use ? await claude.use('room') : null;
    if (!rooms) return () => {};
    const named = await rooms.join(`ee-${client.code.toLowerCase()}`);
    await named.presence({ cid: clientId });
    const apply = (peers: readonly any[]) =>
      client.setConnected(new Set(peers.map((p) => p?.presence?.cid).filter((x): x is string => typeof x === 'string')));
    apply(named.peers());
    const off = named.onPeers((c: any) => apply(c.peers));
    return () => {
      off?.();
      void named.leave?.();
    };
  } catch {
    return () => {};
  }
}

/** Opens a room (and keeps it open while mounted) and returns its live state. */
export function useRoom(code: string | null) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!code) return;
    setRoom(null);
    setError(null);
    const client = new RoomClient(store, code, clientId, (e) => console.error('Estate Empire:', e));
    clients.set(code, client);
    let stopPresence = () => {};
    let alive = true;
    const sync = () => {
      setError(client.error);
      setRoom(client.view());
    };
    const off = client.subscribe(sync);
    client.start();
    void trackPresence(client).then((s) => {
      if (alive) stopPresence = s;
      else s();
    });
    return () => {
      alive = false;
      off();
      stopPresence();
      client.stop();
      if (clients.get(code) === client) clients.delete(code);
    };
  }, [code]);
  return { room, error };
}
