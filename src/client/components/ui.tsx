import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { play } from '../sound';

export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean | 'xl';
  footer?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className={`pop-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-amber-200/20 bg-gradient-to-b from-stone-800 to-stone-900 shadow-2xl ${
          wide === 'xl' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-md'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="font-display text-xl font-bold text-amber-100">{title}</h2>
          {onClose && (
            <button className="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ token, color, size = 36, ring, dim }: { token: string; color: string; size?: number; ring?: boolean; dim?: boolean }) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-full ${ring ? 'pulse-ring' : ''}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 30%, ${color}ee, ${color}88 60%, ${color}55)`,
        boxShadow: `0 2px 6px rgba(0,0,0,.45), inset 0 -3px 6px rgba(0,0,0,.25), inset 0 2px 4px rgba(255,255,255,.35)`,
        border: '2px solid rgba(255,255,255,.75)',
        fontSize: size * 0.52,
        filter: dim ? 'grayscale(1) opacity(.5)' : undefined,
      }}
    >
      <span style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.4))' }}>{token}</span>
    </div>
  );
}

// ───── Toasts ─────

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'warn';
  icon?: string;
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });
let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq;
    setToasts((x) => [...x.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-14 z-[60] flex w-[380px] -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`slide-in pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-xl backdrop-blur ${
              t.tone === 'good'
                ? 'border-emerald-400/40 bg-emerald-950/85'
                : t.tone === 'bad'
                  ? 'border-rose-400/40 bg-rose-950/85'
                  : t.tone === 'warn'
                    ? 'border-amber-400/40 bg-amber-950/85'
                    : 'border-white/15 bg-stone-900/90'
            }`}
          >
            {t.icon && <span className="text-base">{t.icon}</span>}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Wraps an async call: shows server errors as toasts. */
export function useRun() {
  const { push } = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (e) {
        play('error');
        push({ text: (e as Error).message, tone: 'bad', icon: '⚠️' });
        return false;
      }
    },
    [push],
  );
}

export function Confirm({ title, body, confirmLabel, danger, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={danger ? 'btn-red' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-white/80">{body}</div>
    </Modal>
  );
}
