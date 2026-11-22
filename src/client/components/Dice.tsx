import { useEffect, useState } from 'react';

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({ value, rolling, size = 52 }: { value: number; rolling: boolean; size?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!rolling) {
      setShown(value);
      return;
    }
    const t = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 70);
    return () => clearInterval(t);
  }, [rolling, value]);
  return (
    <div
      className={`grid grid-cols-3 grid-rows-3 rounded-xl bg-gradient-to-br from-white to-stone-200 p-[14%] ${rolling ? 'dice-rolling' : 'pop-in'}`}
      style={{ width: size, height: size, boxShadow: '0 6px 14px rgba(0,0,0,.35), inset 0 -3px 0 rgba(0,0,0,.12)', border: '1px solid rgba(0,0,0,.15)' }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center justify-center">
          {PIPS[shown]?.includes(i) && <div className="rounded-full bg-stone-900" style={{ width: size * 0.16, height: size * 0.16 }} />}
        </div>
      ))}
    </div>
  );
}

export default function Dice({ dice, rolling, size }: { dice: [number, number] | null; rolling: boolean; size?: number }) {
  const [a, b] = dice ?? [1, 1];
  return (
    <div className="flex items-center justify-center gap-3">
      <Die value={a} rolling={rolling} size={size} />
      <Die value={b} rolling={rolling} size={size} />
    </div>
  );
}
