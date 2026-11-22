import { useEffect, useState } from 'react';
import Home from './screens/Home';
import History from './screens/History';
import Lobby from './screens/Lobby';
import Game from './screens/Game';
import { sharedStorage, useRoom } from './net';
import { unlockAudio } from './sound';
import { currentPath, navigate, subscribeNav } from './nav';

type Route = { name: 'home' } | { name: 'history' } | { name: 'room'; code: string };

function parse(path: string): Route {
  const [a, b] = path.replace(/^\//, '').split('/');
  if (a === 'history') return { name: 'history' };
  if (a === 'room' && b) return { name: 'room', code: b.toUpperCase() };
  return { name: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parse(currentPath()));
  useEffect(() => {
    const off = subscribeNav(() => setRoute(parse(currentPath())));
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return off;
  }, []);

  return (
    <div className="h-full">
      {!sharedStorage && (
        <div className="fixed left-1/2 top-2 z-[70] -translate-x-1/2 rounded-full bg-amber-700 px-4 py-1 text-xs font-semibold shadow-lg">
          Shared game data is not available here, so only Pass &amp; Play works.
        </div>
      )}
      {route.name === 'home' && <Home />}
      {route.name === 'history' && <History />}
      {route.name === 'room' && <RoomRoute code={route.code} />}
    </div>
  );
}

function RoomRoute({ code }: { code: string }) {
  const { room, error } = useRoom(code);
  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="panel p-6 text-center">
          <p className="mb-4 text-lg">{error}</p>
          <button className="btn-primary" onClick={() => navigate('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  if (!room) return <div className="flex h-full items-center justify-center text-white/60">Loading room {code}…</div>;
  if (room.status === 'lobby' || !room.game) return <Lobby room={room} />;
  return <Game room={room} />;
}
