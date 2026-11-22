import { useState } from 'react';
import { call, clientId, sharedStorage } from '../net';
import { navigate } from '../nav';
import { useRun } from '../components/ui';
import { BOARD, GROUP_COLORS } from '../../engine/board';

export default function Home() {
  const [code, setCode] = useState('');
  const run = useRun();

  const create = (mode: 'local' | 'online') =>
    run(async () => {
      const r = await call('room:create', { clientId, mode });
      navigate(`/room/${r.code}`);
    });

  const join = () =>
    run(async () => {
      const c = code.trim().toUpperCase();
      if (!c) throw new Error('Enter a room code.');
      await call('room:join', { clientId, code: c });
      navigate(`/room/${c}`);
    });

  const strip = BOARD.filter((s) => s.group).map((s) => GROUP_COLORS[s.group!]);

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-2 max-w-md overflow-hidden rounded-full">
            {strip.map((c, i) => (
              <div key={i} className="flex-1" style={{ background: c }} />
            ))}
          </div>
          <h1 className="font-display text-6xl font-black tracking-tight text-amber-100 drop-shadow-[0_4px_12px_rgba(0,0,0,.6)]">Estate Empire</h1>
          <p className="mt-3 text-lg text-amber-100/60">The international property board game for 4–10 tycoons.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <div className="panel flex flex-col p-6">
            <div className="mb-2 text-3xl">🛋️</div>
            <h2 className="font-display text-2xl font-bold text-amber-100">Pass &amp; Play</h2>
            <p className="mb-5 mt-1 flex-1 text-sm text-white/60">Everyone plays on this laptop, taking turns at the keyboard.</p>
            <button className="btn-primary" onClick={() => create('local')}>
              New local game
            </button>
          </div>
          <div className="panel flex flex-col p-6">
            <div className="mb-2 text-3xl">🌐</div>
            <h2 className="font-display text-2xl font-bold text-amber-100">Host Online</h2>
            <p className="mb-5 mt-1 flex-1 text-sm text-white/60">Create a private room. Friends open this page and join with the room code. Keep this page open while you play: it runs the game for everyone.</p>
            <button className="btn-green" disabled={!sharedStorage} onClick={() => create('online')}>
              Create private room
            </button>
          </div>
          <div className="panel flex flex-col p-6">
            <div className="mb-2 text-3xl">🔑</div>
            <h2 className="font-display text-2xl font-bold text-amber-100">Join a Room</h2>
            <p className="mb-3 mt-1 text-sm text-white/60">Got a code from the host? Enter it here.</p>
            <input
              className="input mb-3 text-center font-mono text-lg uppercase tracking-[0.3em]"
              placeholder="ABCDE"
              maxLength={5}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button className="btn-ghost" disabled={!sharedStorage} onClick={join}>
              Join
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button className="btn-ghost" onClick={() => navigate('/history')}>
            📜 Game history &amp; resume saved games
          </button>
        </div>
      </div>
    </div>
  );
}
