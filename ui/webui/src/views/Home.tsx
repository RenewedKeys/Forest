import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui';
import { StatusBadge, CountdownBadge } from '../widgets';
import { AccountModal } from '../components/AccountModal';
import { AccountWizard } from '../components/AccountWizard';
import { ConfirmModal, type ConfirmOpts } from '../components/ConfirmModal';
import { api } from '../bridge';
import type { Account, AccountStatus, Config, LaunchState } from '../types';
import {
  DndContext, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const LAUNCHABLE = new Set<LaunchState>(['INACTIVE', 'FAILED', 'TERMINATED', 'TIMEOUT', 'WRONG SE PASSWORD', 'LOGIN STUCK']);
const isLaunchable = (s: LaunchState) => LAUNCHABLE.has(s);
const isRunning = (s: LaunchState) => !isLaunchable(s);
const BOOTING = new Set<LaunchState>(['LAUNCH WINDOWER', 'LAUNCH ASHITA']);
const canTerminate = (s: LaunchState) => isRunning(s) && !BOOTING.has(s);

export default function Home({ accounts, statuses, config, refreshAccounts, sel, setSel }:
  { accounts: Account[]; statuses: Record<string, AccountStatus>; config: Config | null; refreshAccounts: () => void;
    sel: Set<string>; setSel: React.Dispatch<React.SetStateAction<Set<string>>> }) {
  const [modal, setModal] = useState<{ account: Account | null } | null>(null);
  const [wizard, setWizard] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmOpts | null>(null);
  const [, setPopoverOpen] = useState(false);
  const [flashProfile, setFlashProfile] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const statusOf = (p: string): LaunchState => statuses[p]?.status ?? 'INACTIVE';

  const selList = useMemo(() => [...sel], [sel]);
  const canLaunch = selList.some((p) => isLaunchable(statusOf(p)));
  const canTerm = selList.some((p) => canTerminate(statusOf(p)));


  const selDragMode = useRef<null | 'add' | 'remove'>(null);
  const [selDragActive, setSelDragActive] = useState(false);
  const selDragStart = (p: string) => {
    setSel((s) => {
      const willAdd = !s.has(p);
      selDragMode.current = willAdd ? 'add' : 'remove';
      const n = new Set(s);
      willAdd ? n.add(p) : n.delete(p);
      return n;
    });
    setSelDragActive(true);
  };
  const selDragOver = (p: string) => {
    const mode = selDragMode.current;
    if (!mode) return;
    setSel((s) => {
      if (mode === 'add' && !s.has(p)) { const n = new Set(s); n.add(p); return n; }
      if (mode === 'remove' && s.has(p)) { const n = new Set(s); n.delete(p); return n; }
      return s;
    });
  };
  useEffect(() => {
    const end = () => { selDragMode.current = null; setSelDragActive(false); };
    window.addEventListener('mouseup', end);
    window.addEventListener('mouseleave', end);
    return () => { window.removeEventListener('mouseup', end); window.removeEventListener('mouseleave', end); };
  }, []);

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const order = accounts.map((a) => a.profile);
    const oldIdx = order.indexOf(String(e.active.id));
    const newIdx = order.indexOf(String(e.over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(order, oldIdx, newIdx);
    const moved = String(e.active.id);
    await api.reorder(next);
    refreshAccounts();
    setFlashProfile(moved);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashProfile(null), 950);
  }
  useEffect(() => () => { if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current); }, []);

  const launchTargets = accounts.filter((a) => sel.has(a.profile) && isLaunchable(statusOf(a.profile))).map((a) => a.profile);
  const termTargets = accounts.filter((a) => sel.has(a.profile) && canTerminate(statusOf(a.profile))).map((a) => a.profile);

  const launchProfiles = (targets: string[]) => {
    if (targets.length === 0) return;
    const noAutoLogin = !!config && config.disableAutoLogin && !config.hidePolWindow;
    if (!noAutoLogin) { api.launch(targets); return; }
    const many = targets.length > 1;
    setConfirm({
      title: 'Launch Without Auto-Login',
      confirmText: many ? `Launch ${targets.length}` : 'Launch',
      message: (
        <>
          <div>Auto-Login is off and the PlayOnline window is shown, so Forest will <b className="text-fg">not</b> log in through PlayOnline for {many ? 'any of the selected accounts' : 'this account'}.</div>
          <div className="mt-2">PlayOnline will open{many ? ' for each account' : ''} and you'll need to log in manually.</div>
        </>
      ),
      onConfirm: () => { api.launch(targets); },
    });
  };
  const launchSel = () => launchProfiles(launchTargets);

  const confirmTerminate = (profiles: string[]) => {
    if (profiles.length === 0) return;
    const lines = profiles.map((p) => { const pid = statuses[p]?.pid ?? 0; return pid > 0 ? `${p}  (pid ${pid})` : `${p}  (launching)`; });
    setConfirm({
      title: profiles.length === 1 ? 'Terminate Account' : 'Terminate Accounts',
      danger: true,
      confirmText: profiles.length === 1 ? 'Terminate' : `Terminate ${profiles.length}`,
      message: (
        <>
          <div className="mb-2">The following {profiles.length === 1 ? 'process' : 'processes'} will be closed. Your hand-run characters are not affected.</div>
          <ul className="space-y-1 text-fg">{lines.map((l) => <li key={l}>•&nbsp;&nbsp;{l}</li>)}</ul>
        </>
      ),
      onConfirm: () => { api.terminate(profiles); },
    });
  };
  const termSel = () => confirmTerminate(termTargets);

  const removeAccount = (a: Account) => setConfirm({
    title: 'Remove Account', danger: true, confirmText: 'Remove',
    message: <>Remove <b className="text-fg">{a.profile}</b> and its stored credentials? This cannot be undone.</>,
    onConfirm: async () => { await api.removeAccount(a.profile); setSel((s) => { const n = new Set(s); n.delete(a.profile); return n; }); refreshAccounts(); },
  });


  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <h1 className="text-[12px] font-bold tracking-[0.14em] text-fg-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">ACCOUNTS <span className="text-fg-3">({accounts.length})</span></h1>
        <div className="ml-auto">
          <Button variant="accent" onClick={() => setWizard(true)}>+ ADD ACCOUNT</Button>
        </div>
      </div>

      <ClockSkewBanner config={config} anyAccountHasOtp={accounts.some((a) => a.hasTotp)} />

      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-[9px] font-bold tracking-[0.12em] text-fg-4">
          <span className="w-6 shrink-0" aria-hidden="true" />
          <span className="flex-1">NAME</span>
          <span className="w-8 text-center">TYPE</span>
          <span className="w-20 @max-[520px]:hidden">PROFILE</span>
          <span className="w-6 text-center">SLOT</span>
          <span className="w-40 text-center">STATUS</span>
          <span className="w-20 text-center">MANAGE</span>
        </div>

        {accounts.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-fg-4">
            No accounts yet. Click <b className="text-fg-2">+ ADD ACCOUNT</b> to create one.
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={accounts.map((a) => a.profile)} strategy={verticalListSortingStrategy}>
            {accounts.map((a) => (
              <SortableRow key={a.profile} id={a.profile}>
                {({ setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging }) => {
                  const st = statusOf(a.profile);
                  const eff = a.launcher === 'Default' ? (config?.defaultLauncher ?? 'Windower') : a.launcher;
                  const style: React.CSSProperties = {
                    transform: CSS.Transform.toString(transform),
                    transition,
                    zIndex: isDragging ? 50 : undefined,
                    position: isDragging ? 'relative' : undefined,
                  };
                  return (
                    <div
                      ref={setNodeRef}
                      style={style}
                      onMouseDown={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button, a, input, select, textarea, [data-grip]')) return;
                        e.preventDefault();
                        selDragStart(a.profile);
                      }}
                      onMouseEnter={() => selDragOver(a.profile)}
                      className={`group flex items-center gap-2 px-3 py-2.5 border-b border-line last:border-0 cursor-pointer touch-none ${
                        sel.has(a.profile)
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/15 border-l-2 border-l-emerald-500/70 pl-[10px]'
                          : 'hover:bg-surface-hover'
                      } ${selDragActive ? 'select-none' : ''} ${isDragging ? `${sel.has(a.profile) ? '' : 'bg-surface'} shadow-[0_12px_30px_rgba(0,0,0,0.55)] ring-1 ring-accent/60 rounded-md !cursor-grabbing` : ''} ${flashProfile === a.profile && !isDragging ? 'row-reorder-flash' : ''}`}
                    >
                      <span
                        ref={setActivatorNodeRef}
                        {...attributes}
                        {...listeners}
                        data-grip="1"
                        title="Drag to reorder launch sequence"
                        aria-label="Drag to reorder"
                        className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-fg-3 opacity-40 group-hover:opacity-100 hover:bg-fg/10 hover:text-fg-2 cursor-grab active:cursor-grabbing transition-all outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor" aria-hidden="true">
                          <circle cx="9"  cy="6"  r="1.8" />
                          <circle cx="15" cy="6"  r="1.8" />
                          <circle cx="9"  cy="12" r="1.8" />
                          <circle cx="15" cy="12" r="1.8" />
                          <circle cx="9"  cy="18" r="1.8" />
                          <circle cx="15" cy="18" r="1.8" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-fg-2 truncate">{a.profile}</div>
                      </div>
                      <span className="w-8 grid place-items-center">
                        <img src={eff === 'Ashita' ? '/ashita.png' : '/windower.png'} alt={eff} title={eff} className="w-5 h-5 object-contain" />
                      </span>
                      <span className="w-20 @max-[520px]:hidden text-[11px] text-fg-3 truncate">{a.windower || '—'}</span>
                      <span className="w-6 text-center text-[11px] text-fg-3 tabular-nums">{a.polSlot || '—'}</span>
                      <span className="w-40 flex justify-center">
                        {st === 'RUNNING' && statuses[a.profile]?.countdownSeconds != null
                          ? <CountdownBadge
                              seconds={statuses[a.profile]!.countdownSeconds!}
                              totalSeconds={statuses[a.profile]?.countdownTotalSeconds ?? 0}
                            />
                          : <StatusBadge status={st} />}
                      </span>
                      <span className="w-20 flex items-center justify-center gap-1 relative">
                        <IconBtn title="Edit" onClick={() => setModal({ account: a })}>✎</IconBtn>
                        <IconBtn title="Remove" onClick={() => removeAccount(a)}>🗑</IconBtn>
                        {st === 'RUNNING' && (
                          <ManualTimerButton
                            profile={a.profile}
                            activeSource={statuses[a.profile]?.countdownSource ?? null}
                            activeSeconds={statuses[a.profile]?.countdownSeconds ?? null}
                            onOpenChange={setPopoverOpen}
                          />
                        )}
                        {isLaunchable(st)
                          ? <IconBtn title="Launch" success onClick={() => launchProfiles([a.profile])}>▶</IconBtn>
                          : <IconBtn title="Terminate" danger disabled={!canTerminate(st)} onClick={() => confirmTerminate([a.profile])}>✕</IconBtn>}
                      </span>
                    </div>
                  );
                }}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
      </div>

        </div>
      </div>

      {/* large bottom action bar (like the original Forest app) */}
      <div className="shrink-0 flex gap-2.5 px-4 py-3 bg-panel border-t border-line">
        <button
          onClick={canLaunch ? launchSel : undefined}
          className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold tracking-[0.08em] transition-colors ${
            canLaunch ? 'bg-green-700 text-white hover:bg-green-600' : 'bg-surface-raised text-fg-4 border border-line cursor-default'
          }`}
        >LAUNCH{launchTargets.length ? ` (${launchTargets.length})` : ''}</button>
        <button
          onClick={canTerm ? termSel : undefined}
          className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold tracking-[0.08em] transition-colors ${
            canTerm ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-surface-raised text-fg-4 border border-line cursor-default'
          }`}
        >TERMINATE{termTargets.length ? ` (${termTargets.length})` : ''}</button>
      </div>

      {wizard && (
        <AccountWizard
          accounts={accounts}
          config={config}
          onClose={() => setWizard(false)}
          onSaved={refreshAccounts}
          onQuickAdd={() => { setWizard(false); setModal({ account: null }); }}
        />
      )}
      {modal && (
        <AccountModal account={modal.account} accounts={accounts} config={config} onClose={() => setModal(null)} onSaved={refreshAccounts} />
      )}
      <ConfirmModal opts={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function SortableRow({ id, children }: {
  id: string;
  children: (s: ReturnType<typeof useSortable>) => React.ReactNode;
}) {
  const s = useSortable({ id });
  return <>{children(s)}</>;
}

function ClockSkewBanner({ config, anyAccountHasOtp }: { config: Config | null; anyAccountHasOtp: boolean }) {
  const [skew, setSkew] = useState<number | null | undefined>(config?.clockSkewSeconds ?? undefined);
  const [rechecking, setRechecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setSkew(config?.clockSkewSeconds ?? undefined); }, [config?.clockSkewSeconds]);

  if (!anyAccountHasOtp) return null;
  if (skew === undefined || skew === null) return null;
  if (Math.abs(skew) <= 15) return null;
  if (dismissed) return null;

  const behind = skew < 0;
  const secs = Math.abs(skew).toFixed(0);

  return (
    <div className="mb-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
      <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-amber-300 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold text-amber-200 mb-0.5">
          Windows clock is {secs}s {behind ? 'behind' : 'ahead of'} real time
        </div>
        <div className="text-[11px] text-amber-100/80 leading-snug">
          This will cause auto-login to fail with "Wrong SE Password" for accounts with an OTP.
          The OTP code Forest generates will be out-of-window and rejected by SE.
          Sync your Windows clock, then re-check below.
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          <Button onClick={() => api.openExternal('ms-settings:dateandtime')}>Open Windows Time Settings</Button>
          <Button onClick={async () => {
            setRechecking(true);
            try {
              const r = await api.recheckClock();
              setSkew(r?.clockSkewSeconds ?? null);
            } catch { setSkew(null); }
            finally { setRechecking(false); }
          }}>{rechecking ? 'Rechecking…' : 'Recheck Now'}</Button>
          <Button onClick={() => setDismissed(true)}>Dismiss for This Session</Button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick, danger, success, active, disabled }:
  { children: React.ReactNode; title: string; onClick?: () => void; danger?: boolean; success?: boolean; active?: boolean; disabled?: boolean }) {
  const tone =
    disabled ? 'text-fg-4/30 cursor-default'
    : danger  ? 'text-fg-3 hover:text-white hover:bg-red-600'
    : success ? 'text-emerald-400 hover:text-white hover:bg-green-700'
    : active  ? 'text-amber-300 hover:text-white hover:bg-amber-600'
              : 'text-fg-3 hover:text-fg hover:bg-line';
  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      className={`grid place-items-center w-6 h-6 rounded text-[12px] transition-colors ${tone}`}
    >{children}</button>
  );
}

const PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1h',  seconds: 60 * 60 },
  { label: '3h',  seconds: 3 * 60 * 60 },
  { label: '6h',  seconds: 6 * 60 * 60 },
  { label: '12h', seconds: 12 * 60 * 60 },
];

function ManualTimerButton({ profile, activeSource, activeSeconds, onOpenChange }:
  { profile: string; activeSource: 'auto' | 'manual' | null; activeSeconds: number | null; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpenLocal] = useState(false);
  const [h, setH] = useState(1);
  const [m, setM] = useState(0);
  const popRef = useRef<HTMLDivElement | null>(null);

  const setOpen = (v: boolean) => { setOpenLocal(v); onOpenChange?.(v); };

  useEffect(() => () => { onOpenChange?.(false); }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const hasActive = activeSource != null && activeSeconds != null;
  const set = (seconds: number) => { if (seconds > 0) { void api.setManualTerminate(profile, seconds); setOpen(false); } };
  const cancel = () => { void api.clearManualTerminate(profile); setOpen(false); };
  const customSet = () => set(h * 3600 + m * 60);

  return (
    <>
      <IconBtn title={hasActive ? `Timer active (${activeSource === 'manual' ? 'manual' : 'auto-terminate'}) — edit` : 'Set termination timer'} active={hasActive} onClick={() => setOpen(true)}>⏱</IconBtn>
      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-7 z-50 w-80 rounded-lg bg-surface-raised border border-line shadow-lg p-3 text-[12px]"
        >
          <div className="text-fg-2 mb-2 truncate">Terminate <b className="text-fg">{profile}</b> after…</div>
          <div className="flex gap-1 mb-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => set(p.seconds)}
                className="flex-1 px-1 py-1 rounded border border-line text-fg-2 hover:border-accent hover:text-accent transition-colors">
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <input type="number" min={0} max={48} value={h} onChange={(e) => setH(Math.max(0, Number(e.target.value) || 0))}
              className="w-12 px-1.5 py-1 text-center tabular-nums rounded border border-line bg-field text-fg focus:outline-none focus:border-accent" />
            <span className="text-fg-3">h</span>
            <input type="number" min={0} max={59} value={m} onChange={(e) => setM(Math.max(0, Number(e.target.value) || 0))}
              className="w-12 px-1.5 py-1 text-center tabular-nums rounded border border-line bg-field text-fg focus:outline-none focus:border-accent" />
            <span className="text-fg-3">m</span>
            <button onClick={customSet} disabled={h === 0 && m === 0}
              className="flex-1 px-3 py-1 rounded bg-green-700 text-white font-bold tracking-[0.08em] hover:bg-green-600 disabled:bg-surface disabled:text-fg-4 transition-colors">
              SET
            </button>
          </div>
          {hasActive && (
            <div className="pt-2 border-t border-line flex items-center gap-2">
              <span className="text-fg-3 flex-1">
                Active: <span className="text-amber-300 font-semibold tabular-nums">{formatLeft(activeSeconds!)}</span> left
                <span className="text-fg-4 ml-1">({activeSource === 'manual' ? 'Manual' : 'Auto-Terminate'})</span>
              </span>
              <button onClick={cancel} className="px-2 py-1 rounded border border-red-500/50 text-red-300 hover:bg-red-600 hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function formatLeft(sec: number): string {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
