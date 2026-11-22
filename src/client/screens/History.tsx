import { useEffect, useState } from 'react';
import { navigate } from '../nav';
import { loadGames, removeGame, type GameRow as Row } from '../net';
import { Avatar, Confirm, useRun } from '../components/ui';

export default function History() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const run = useRun();

  const load = () =>
    loadGames()
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-4xl font-black text-amber-100">Game History</h1>
          <button className="btn-ghost" onClick={() => navigate('/')}>
            ← Home
          </button>
        </div>
        {!rows && <p className="text-white/50">Loading…</p>}
        {rows && rows.length === 0 && <p className="panel p-6 text-white/60">No saved games yet. Every game is saved automatically as you play.</p>}
        <div className="flex flex-col gap-3">
          {rows?.map((r) => (
            <div key={r.code} className="panel flex flex-wrap items-center gap-4 p-4">
              <div className="w-24">
                <div className="font-mono text-lg font-bold tracking-widest text-amber-200">{r.code}</div>
                <div className="text-xs text-white/50">{r.mode === 'online' ? '🌐 Online' : '🛋️ Local'}</div>
              </div>
              <div className="flex -space-x-2">
                {r.summary.players.map((p, i) => (
                  <Avatar key={i} token={p.token} color={p.color} size={30} />
                ))}
              </div>
              <div className="min-w-[200px] flex-1 text-sm">
                <div className="font-semibold">
                  {r.status === 'lobby' && <span className="text-sky-300">In lobby</span>}
                  {r.status === 'playing' && <span className="text-emerald-300">In progress · turn {r.summary.turn}{r.summary.paused ? ' · paused' : ''}</span>}
                  {r.status === 'finished' && <span className="text-amber-300">🏆 {r.summary.winner ?? '—'} won</span>}
                </div>
                <div className="text-xs text-white/50">
                  {r.summary.players.map((p) => p.name).join(', ') || 'No players yet'} · {r.summary.gameMode === 'timed' ? 'Timed' : 'Classic'} · last played {new Date(r.updatedAt).toLocaleString()}
                </div>
              </div>
              <button className="btn-primary btn-sm" onClick={() => navigate(`/room/${r.code}`)}>
                {r.status === 'playing' ? 'Resume' : r.status === 'lobby' ? 'Open lobby' : 'View'}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setDel(r.code)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
      {del && (
        <Confirm
          title="Delete saved game?"
          body={`Game ${del} will be permanently deleted.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDel(null)}
          onConfirm={() =>
            run(async () => {
              await removeGame(del);
              setDel(null);
              await load();
            })
          }
        />
      )}
    </div>
  );
}
