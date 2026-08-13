import { useState } from 'react';
import { Modal } from '../widgets';
import { Button, RowStacked, Segmented, Select, TextField } from '../ui';
import { api } from '../bridge';
import { ConfirmModal, type ConfirmOpts } from './ConfirmModal';
import type { Account, Config, Launcher } from '../types';

function PasswordField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-1.5">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
      />
      <Button onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
    </div>
  );
}

export function AccountModal({ account, accounts, config, onClose, onSaved }:
  { account: Account | null; accounts: Account[]; config: Config | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!account;
  const [name, setName] = useState(account?.profile ?? '');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [launcher, setLauncher] = useState<Launcher>(account?.launcher ?? 'Default');
  const [windower, setWindower] = useState(account?.windower ?? '');
  const [polSlot, setPolSlot] = useState(account?.polSlot ? String(account.polSlot) : '1');
  const [ingameSlot, setIngameSlot] = useState(account?.ingameSlot ? String(account.ingameSlot) : '1');
  const [args, setArgs] = useState(account?.launchArgs ?? '');
  const [launcherExe, setLauncherExe] = useState(account?.launcherExe ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearTotp, setClearTotp] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmOpts | null>(null);

  const effective = launcher === 'Default' ? (config?.defaultLauncher ?? 'Windower') : launcher;
  const profileLabel = effective === 'Ashita' ? 'Ashita Boot Config (.ini)' : 'Windower Profile';

  function validate(): string | null {
    const n = name.trim();
    if (!n) return 'Account name is required.';
    if (!editing && accounts.some((a) => a.profile.toLowerCase() === n.toLowerCase())) return `An account named "${n}" already exists.`;
    if (!editing && !password) return 'SE password is required for a new account.';
    const ps = polSlot.trim();
    if (ps) {
      const v = Number(ps);
      if (!Number.isInteger(v) || v < 1 || v > 20) return 'POL member-list slot must be 1-20 (or blank).';
    }
    const is = ingameSlot.trim();
    if (is) { const v = Number(is); if (!Number.isInteger(v) || v < 1 || v > 16) return 'Ingame character slot must be 1-16 (or blank).'; }
    const t = totp.replace(/\s/g, '');
    if (t && !/^[A-Z2-7]+$/i.test(t)) return 'One-Time Password secret must be a Base32 key (letters A-Z and digits 2-7).';
    return null;
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      await api.saveAccount({
        profile: name.trim(),
        originalProfile: account?.profile,
        windower: windower.trim() || (effective === 'Ashita' ? 'default.ini' : 'Default Profile'),
        polSlot: Number(polSlot) || 1,
        ingameSlot: Number(ingameSlot) || 1,
        launcher,
        launchArgs: args.trim(),
        launcherExe: launcherExe.trim() || undefined,
        password: password || undefined,
        totpSecret: clearTotp ? undefined : (totp.replace(/\s/g, '') || undefined),
        clearTotp: clearTotp || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <>
    <ConfirmModal opts={confirm} onClose={() => setConfirm(null)} />
    <Modal
      open
      width={460}
      title={editing ? `Edit Account — ${account!.profile}` : 'Add Account'}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={busy ? undefined : save}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      {err && (
        <div className="mb-3 text-[11px] rounded-md px-3 py-2 text-red-300 bg-red-500/12 border border-red-500/40">{err}</div>
      )}
      <div className="rounded-xl bg-surface border border-line divide-y divide-line overflow-hidden">
        <RowStacked label="Account Name" desc="Unique name for this account.">
          <TextField value={name} onChange={setName} placeholder="e.g. Tank" />
        </RowStacked>
        <RowStacked label="SE Password" desc={editing ? 'Leave blank to keep the existing password.' : 'Required.'}>
          <PasswordField value={password} onChange={setPassword} placeholder={editing ? '•••••••• (unchanged)' : 'SE password'} />
        </RowStacked>
        <RowStacked label="(OTP) SE Account Software Authenticator Setup Key" desc="OTP Password setup key provided to you when registering a Software Authenticator to your SE Account.">
          <div className="flex items-stretch gap-1.5">
            <div className="flex-1 min-w-0">
              <PasswordField
                value={totp}
                onChange={(v) => { setTotp(v); if (v) setClearTotp(false); }}
                placeholder={clearTotp
                  ? 'stored OTP will be cleared on save'
                  : (editing && account?.hasTotp
                      ? '•••••••• (stored)'
                      : 'e.g. 2323 EOFK 23KER 7Z2M ...')}
              />
            </div>
            {editing && account?.hasTotp && !clearTotp && (
              <button
                type="button"
                title="Remove stored OTP"
                aria-label="Remove stored OTP"
                onClick={() => setConfirm({
                  title: 'Remove stored OTP?',
                  message: (
                    <>
                      This will erase the stored authenticator secret for <span className="font-semibold text-fg">{account.profile}</span>.
                      Future launches will not auto-fill an OTP code until you add a new setup key.
                      <br /><br />
                      The change is applied when you click <span className="font-semibold text-fg">Save</span>.
                    </>
                  ),
                  confirmText: 'Remove OTP',
                  danger: true,
                  onConfirm: () => { setClearTotp(true); setTotp(''); },
                })}
                className="px-2.5 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
              </button>
            )}
            {clearTotp && (
              <button
                type="button"
                onClick={() => setClearTotp(false)}
                className="px-2.5 rounded-md border border-line bg-surface-raised text-fg-3 hover:text-fg-2 text-[11px] font-semibold"
              >
                Undo
              </button>
            )}
          </div>
          {editing && account?.hasTotp && !clearTotp && (
            <div
              title="An OTP secret is currently stored for this account"
              aria-label="OTP stored"
              className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-bold tracking-wider text-emerald-200 bg-emerald-500/15 border border-emerald-400/40"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="15" r="4" />
                <path d="M10.85 12.15 19 4" /><path d="M18 5l2 2" /><path d="M15 8l2 2" />
              </svg>
              OTP STORED
            </div>
          )}
          {clearTotp && (
            <div className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-bold tracking-wider text-amber-200 bg-amber-500/15 border border-amber-400/40">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
              </svg>
              WILL BE CLEARED ON SAVE
            </div>
          )}
        </RowStacked>
        <RowStacked label="Launcher" desc="Per-account launcher; Default uses the global setting.">
          <Segmented<Launcher> full value={launcher} onChange={setLauncher}
            options={[{ v: 'Default', label: 'Default' }, { v: 'Windower', label: 'Windower' }, { v: 'Ashita', label: 'Ashita v4' }]} />
        </RowStacked>
        <RowStacked
          label={`Custom ${effective} Executable (optional)`}
          desc={`Override the global ${effective} path for this account only. Blank uses the global Settings path.`}>
          <div className="flex gap-1.5">
            <TextField value={launcherExe} onChange={setLauncherExe} placeholder="blank = use global Settings path" />
            <Button onClick={async () => { const p = await api.browse('file', 'exe'); if (p) setLauncherExe(p); }}>Browse</Button>
          </div>
        </RowStacked>
        <RowStacked label={profileLabel} desc={effective === 'Ashita' ? 'Ashita boot config (.ini). Blank uses default.ini.' : 'Windower profile name. Blank uses Default Profile.'}>
          <TextField value={windower} onChange={setWindower} placeholder={effective === 'Ashita' ? 'default.ini' : 'Default Profile'} />
        </RowStacked>
        <RowStacked label="POL Member List Slot" desc="Which slot this account sits on in the PlayOnline member list.">
          <Select
            full
            value={`Account Slot #${polSlot || '1'}`}
            onChange={(v) => setPolSlot(v.replace('Account Slot #', ''))}
            options={Array.from({ length: 20 }, (_, i) => `Account Slot #${i + 1}`)}
          />
        </RowStacked>
        <RowStacked label="Ingame Character Slot" desc="Which character slot to log into in-game.">
          <Select
            full
            value={`Character Slot #${ingameSlot || '1'}`}
            onChange={(v) => setIngameSlot(v.replace('Character Slot #', ''))}
            options={Array.from({ length: 16 }, (_, i) => `Character Slot #${i + 1}`)}
          />
        </RowStacked>
        <RowStacked label="Command Args" desc="Blank = launcher default. {profile} is substituted.">
          <TextField value={args} onChange={setArgs} placeholder={'blank = default'} />
        </RowStacked>
      </div>
    </Modal>
    </>
  );
}
