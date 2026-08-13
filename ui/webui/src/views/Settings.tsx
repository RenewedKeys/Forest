import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Group, Row, RowStacked, Segmented, Slider, TextField, Toggle } from '../ui';
import { api, subscribe } from '../bridge';
import type { Config, UpdateSnapshot } from '../types';

export default function Settings({ config, patchConfig }:
  { config: Config | null; patchConfig: (p: Partial<Config>) => void }) {
  const [exportMsg, setExportMsg] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logsWarnOpen, setLogsWarnOpen] = useState(false);
  if (!config) return <div className="px-5 py-10 text-center text-[12px] text-fg-4">Loading settings…</div>;
  const c = config;

  const PathRow = ({ label, desc, value, browse, save }:
    { label: string; desc: string; value: string; browse: () => Promise<string>; save: (v: string) => void }) => (
    <RowStacked label={label} desc={desc}>
      <div className="flex gap-1.5">
        <TextField value={value} onChange={save} placeholder="not set" />
        <Button onClick={async () => { const p = await browse(); if (p) save(p); }}>Browse</Button>
      </div>
    </RowStacked>
  );

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-2xl px-5 py-4">
      <Group title="LAUNCHER SETUP">
        <PathRow label="Windower Executable" desc="Path to Windower.exe."
          value={c.windowerExe} browse={() => api.browse('file', 'exe')} save={(v) => patchConfig({ windowerExe: v })} />
        <PathRow label="Ashita-cli Executable" desc="Path to Ashita-cli.exe (optional)."
          value={c.ashitaExe} browse={() => api.browse('file', 'exe')} save={(v) => patchConfig({ ashitaExe: v })} />
        <Row label="Default Launcher" desc="Used when an account's launcher is 'Default'.">
          <Segmented value={c.defaultLauncher} onChange={(v) => patchConfig({ defaultLauncher: v })}
            options={[{ v: 'Windower', label: 'Windower' }, { v: 'Ashita', label: 'Ashita v4' }]} />
        </Row>
      </Group>

      <Group title="LAUNCH BEHAVIOR">
        <Row label="Multiple Account Launch Speed" desc="Faster lowers the stagger delay but may cause hangs.">
          <Segmented value={c.fastSequential ? 'fast' : 'regular'} onChange={(v) => patchConfig({ fastSequential: v === 'fast' })}
            options={[{ v: 'regular', label: 'Regular' }, { v: 'fast', label: 'Faster' }]} />
        </Row>
        <RowStacked label="Login Timeout" desc="Max seconds to wait for a login before marking it failed.">
          <Slider value={c.loginTimeoutSeconds} min={30} max={300} suffix="s" onChange={(v) => patchConfig({ loginTimeoutSeconds: v })} />
        </RowStacked>
        <RowStacked label="Shared OTP Cooldown" desc="Forest will stagger consecutive account launches that are detected to have the same OTP by the specified delay.">
          <Slider value={c.minSecondsBetweenLaunches} min={0} max={120} suffix="s" onChange={(v) => patchConfig({ minSecondsBetweenLaunches: v })} />
        </RowStacked>
        <Row label="Launch Selected Accounts Automatically On Startup" desc="Automatically launches selected accounts on bootup.">
          <Toggle on={c.launchSelectedOnStartup} onChange={(v) => patchConfig(
            v ? { launchSelectedOnStartup: true }
              : { launchSelectedOnStartup: false, launchMode: 'Full' }
          )} />
        </Row>
        {c.launchSelectedOnStartup && (
          <Row label="Simple Mode" desc="Launch selected accounts automatically on bootup, then close when all logins complete.">
            <Toggle on={c.launchMode === 'Splash'} onChange={(v) => patchConfig({ launchMode: v ? 'Splash' : 'Full' })} />
          </Row>
        )}
        <Row label="Automatically Terminate Selected Accounts After Delay" desc="Terminate selected accounts after a set amount of time has passed.">
          <Toggle on={c.autoTerminateEnabled} onChange={(v) => patchConfig({ autoTerminateEnabled: v })} />
        </Row>
        {c.autoTerminateEnabled && (
          <RowStacked label="Termination Delay" desc="Countdown starts when the character is confirmed in-game.">
            <DurationPicker
              minutes={c.autoTerminateMinutes}
              onChange={(m) => patchConfig({ autoTerminateMinutes: Math.max(1, m) })}
            />
          </RowStacked>
        )}
      </Group>

      <Group title="PLAYONLINE LOGIN">
        <Row label="Hide PlayOnline Window During Login" desc="Hides the PlayOnline Viewer window by moving it offscreen during the login process.">
          <Toggle on={c.hidePolWindow} onChange={(v) => patchConfig({ hidePolWindow: v })} />
        </Row>
        {!c.hidePolWindow && (
          <Row label="Disable Auto-Login" desc="Skip the account-selection automation entirely.">
            <Toggle on={c.disableAutoLogin} onChange={(v) => patchConfig({ disableAutoLogin: v })} />
          </Row>
        )}
        <Row label="Fast Login" desc="Skips the PlayOnline news fetch so the login screen loads instantly. Works on all regions.">
          <Toggle on={c.usePolProxy} onChange={(v) => patchConfig({ usePolProxy: v })} />
        </Row>
      </Group>

      <Group title="INGAME CHARACTER LOGIN">
        <Row label="Log In Character Automatically" desc="Selects the account's ingame slot when FFXI starts.">
          <Toggle on={c.autoLoginCharacter} onChange={(v) => patchConfig({ autoLoginCharacter: v })} />
        </Row>
        {c.autoLoginCharacter && (
          <Row label="Enable SendInput Fallback (Requires Focus)" desc="OS-level keystrokes if the normal method fails.">
            <Toggle on={c.autoLoginSendInputFallback} onChange={(v) => patchConfig({ autoLoginSendInputFallback: v })} />
          </Row>
        )}
      </Group>

      <Group title="Multi-Launch Game Resolution Correction (Windower)">
        <Row label="Fix FFXI Registry Settings On Launch (Recommended)" desc="Intercepts PlayOnline Viewer's registry read attempt and returns the correct values for the profile's game resolution.">
          <Toggle on={c.overrideFFXiResolution} onChange={(v) => patchConfig({
            overrideFFXiResolution: v,
            ...(v ? { waitForFFXiRegistryReadBetweenLaunches: false } : {}),
          })} />
        </Row>
        <Row label="Fix FFXI Registry Settings On Launch (Legacy)" desc="Wait until the registry reads the proper resolution before launching the next client in multi-launch sequences.">
          <Toggle on={c.waitForFFXiRegistryReadBetweenLaunches} onChange={(v) => patchConfig({
            waitForFFXiRegistryReadBetweenLaunches: v,
            ...(v ? { overrideFFXiResolution: false } : {}),
          })} />
        </Row>
      </Group>

      <Group title="UPDATES">
        <Row label="Check for Updates on Startup" desc="Silently checks for a new Forest release each launch. Only nags if a newer version is available.">
          <Toggle on={c.checkUpdatesOnStartup} onChange={(v) => patchConfig({ checkUpdatesOnStartup: v })} />
        </Row>
        <UpdatesCard currentVersion={c.currentVersion} />
      </Group>

      <Group title="POL ACCOUNT SAFETY">
        <Row label="Backup POL Account File Before Launch" desc="Copies each detected login_w.bin to a rolling backup before Forest launches accounts.">
          <Toggle on={c.loginBinBackupEnabled} onChange={(v) => patchConfig({ loginBinBackupEnabled: v })} />
        </Row>
        {c.loginBinBackupEnabled && (
          <RowStacked label="Backups To Keep" desc="Older backups beyond this count are pruned. Each POL install is retained separately.">
            <Slider value={c.loginBinBackupsKeep} min={1} max={50} suffix="" onChange={(v) => patchConfig({ loginBinBackupsKeep: v })} />
          </RowStacked>
        )}
        <PolBackupPanel config={c} patchConfig={patchConfig} />
      </Group>

      <Group title="DIAGNOSTICS">
        <Row label="Forest Runtime Permission Status" desc="Forest must run at the same Windows privilege level as Windower / Ashita for DLL injection to succeed. If Windower is set to 'Run as administrator' (Compatibility tab), Forest must be too.">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider whitespace-nowrap ${
            c.isElevated
              ? 'text-emerald-200 bg-emerald-500/15 border border-emerald-400/50'
              : 'text-amber-200 bg-amber-500/15 border border-amber-400/50'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${c.isElevated ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {c.isElevated ? 'ADMIN' : 'NOT ELEVATED'}
          </span>
        </Row>
        <Row label="Enable Debug Logging" desc="Verbose logs to help diagnose problems.">
          <Toggle on={c.debugLogging} onChange={(v) => patchConfig({ debugLogging: v })} />
        </Row>
        <RowStacked label="Logs & Support" desc="Diagnostics zip is sanitized (account names redacted) and safe to share. Upload sends the same zip directly to the developer with a label so it can be identified.">
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => setLogsWarnOpen(true)}>Open Logs Folder</Button>
            <Button onClick={async () => { const p = await api.exportDiag(); setExportMsg(p ? `Saved: ${p}` : ''); }}>Export Diagnostics</Button>
            <Button variant="accent" onClick={() => { setUploadMsg(null); setUploadOpen(true); }}>Upload Diagnostics</Button>
          </div>
          {exportMsg && <div className="mt-2 text-[11px] text-emerald-300">{exportMsg}</div>}
          {uploadMsg && (
            <div className={`mt-2 text-[11px] ${uploadMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{uploadMsg.text}</div>
          )}
        </RowStacked>
      </Group>
    </div>
    {uploadOpen && (
      <UploadModal
        defaultLabel={defaultLabel()}
        onCancel={() => setUploadOpen(false)}
        onSubmit={async (label) => {
          setUploadOpen(false);
          setUploadMsg({ ok: true, text: 'Uploading…' });
          try {
            const r = await api.uploadDiag(label);
            if (r.ok) setUploadMsg({ ok: true, text: `Uploaded ✓ — reference: ${r.id ?? '(no id)'}${r.url ? ' (' + r.url + ')' : ''}` });
            else setUploadMsg({ ok: false, text: 'Upload failed: ' + (r.error ?? 'unknown error') });
          }
          catch (e: any) { setUploadMsg({ ok: false, text: 'Upload failed: ' + (e?.message ?? 'unknown') }); }
        }}
      />
    )}
    {logsWarnOpen && (
      <LogsWarnModal
        onCancel={() => setLogsWarnOpen(false)}
        onContinue={() => { setLogsWarnOpen(false); api.openLogs(); }}
        onUploadInstead={() => { setLogsWarnOpen(false); setUploadMsg(null); setUploadOpen(true); }}
      />
    )}
    </div>
  );
}

function defaultLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `forest-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function UploadModal({ defaultLabel, onCancel, onSubmit }:
  { defaultLabel: string; onCancel: () => void; onSubmit: (label: string) => void }) {
  const [label, setLabel] = useState(defaultLabel);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onMouseDown={onCancel}>
      <div className="w-[420px] max-w-[92vw] rounded-xl bg-surface border border-line p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-[13px] font-bold text-fg mb-2">Upload Diagnostics</div>
        <div className="text-[11px] text-fg-3 mb-3 leading-snug">
          Please give this file a short label so I can recognize it easier and diagnose your issue. (your discord, username, etc.).
        </div>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="e.g. zierk-injection-fail"
          className="w-full bg-field border border-line rounded-md px-2.5 py-1.5 text-[12px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 mb-3"
        />
        <div className="flex justify-end gap-1.5">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="accent" onClick={() => onSubmit(label.trim() || defaultLabel)}>Upload</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PolBackupPanel({ config, patchConfig }:
  { config: Config; patchConfig: (p: Partial<Config>) => void }) {
  const [discovery, setDiscovery] = useState<import('../types').PolBackupDiscovery | null>(null);
  const [busy, setBusy] = useState<null | 'discover' | 'run'>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);

  const refresh = async () => {
    setBusy('discover');
    try { setDiscovery(await api.polBackupDiscover()); }
    catch (e: any) { setStatusMsg('Discovery failed: ' + (e?.message ?? 'unknown')); }
    finally { setBusy(null); }
  };
  useEffect(() => { refresh(); }, [config.loginBinPathOverrides]);

  const overrides = config.loginBinPathOverrides;
  const addOverride = () => {
    const t = draft.trim();
    if (!t) return;
    if (overrides.some((p) => p.toLowerCase() === t.toLowerCase())) { setDraft(''); return; }
    patchConfig({ loginBinPathOverrides: [...overrides, t] });
    setDraft('');
  };
  const removeOverride = (p: string) => {
    patchConfig({ loginBinPathOverrides: overrides.filter((x) => x !== p) });
  };
  const browseFile = async () => {
    const p = await api.browse('file');
    if (p) { setDraft(p); }
  };

  return (
    <RowStacked label="Detected & Custom Paths" desc="Forest reads POL install paths from the Windows registry. If your install is non-standard or wasn't detected, add the full path to login_w.bin manually.">
      <div className="space-y-2">
        {discovery && (
          <div className="rounded-md bg-field border border-line p-2">
            {discovery.paths.length === 0 ? (
              <div className="text-[11px] text-fg-4 italic">No POL installs detected. Add a path override below.</div>
            ) : (
              discovery.paths.map((p) => (
                <div key={p.path} className="flex items-center gap-2 text-[11px] leading-tight py-0.5">
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${p.exists ? 'bg-emerald-400' : 'bg-amber-400'}`} title={p.exists ? 'File exists' : 'File missing'} />
                  <span className="text-fg-3 font-mono truncate flex-1">{p.path}</span>
                  <span className="text-fg-4 text-[10px] shrink-0">{p.source}</span>
                </div>
              ))
            )}
          </div>
        )}
        <div className="flex gap-1.5">
          <TextField value={draft} onChange={setDraft} placeholder="Full path to a custom login_w.bin" />
          <Button onClick={browseFile}>Browse</Button>
          <Button variant="accent" onClick={addOverride}>Add</Button>
        </div>
        {overrides.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {overrides.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 bg-surface-raised border border-line rounded-md pl-2 pr-1 py-0.5 text-[10px] font-mono text-fg-2 max-w-full">
                <span className="truncate">{p}</span>
                <button onClick={() => removeOverride(p)} className="grid place-items-center w-4 h-4 rounded text-fg-4 hover:text-fg leading-none shrink-0">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <Button full onClick={async () => { setBusy('run'); setStatusMsg('Backing up…'); try { await api.polBackupRunNow(); setStatusMsg('Backup complete ✓'); await refresh(); } catch (e: any) { setStatusMsg('Backup failed: ' + (e?.message ?? 'unknown')); } finally { setBusy(null); } }}>
            {busy === 'run' ? 'Backing Up…' : 'Backup Now'}
          </Button>
          <Button full variant="accent" onClick={() => setRestoreOpen(true)}>Restore From Backup…</Button>
          <Button full onClick={() => api.polBackupOpenDir()}>Open Backups Folder</Button>
        </div>
        {statusMsg && <div className="text-[11px] text-fg-3">{statusMsg}</div>}
      </div>
      {restoreOpen && (
        <RestoreModal onClose={() => setRestoreOpen(false)} />
      )}
    </RowStacked>
  );
}

function RestoreModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<import('../types').PolBackupEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<null | { backupPath: string; targetPath: string }>(null);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const [result, setResult] = useState<null | { ok: boolean; text: string; emergencyPath?: string | null }>(null);

  const load = async () => {
    setLoading(true);
    try { setEntries(await api.polBackupList()); }
    catch (e: any) { setEntries([]); setResult({ ok: false, text: 'Failed to list backups: ' + (e?.message ?? 'unknown') }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const doRestore = async () => {
    if (!pending) return;
    setRestoringPath(pending.backupPath);
    try {
      const r = await api.polBackupRestore(pending.backupPath, pending.targetPath);
      if (r.ok) setResult({ ok: true, text: 'Restore complete ✓ — POL can now be launched again.', emergencyPath: r.emergencyBackupPath });
      else setResult({ ok: false, text: 'Restore failed: ' + (r.error ?? 'unknown error'), emergencyPath: r.emergencyBackupPath });
    }
    catch (e: any) { setResult({ ok: false, text: 'Restore failed: ' + (e?.message ?? 'unknown') }); }
    finally { setRestoringPath(null); setPending(null); await load(); }
  };

  const grouped: Record<string, import('../types').PolBackupEntry[]> = {};
  (entries ?? []).forEach((e) => { (grouped[e.targetPath] ??= []).push(e); });

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="w-[720px] max-w-full max-h-[85vh] rounded-xl bg-surface border border-line shadow-2xl flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center gap-3">
          <div className="text-[13px] font-bold text-fg">Restore POL Account File From Backup</div>
        </div>

        <div className="px-4 pt-3 pb-2 text-[11px] text-amber-100/90 bg-amber-500/10 border-b border-amber-500/40 leading-relaxed">
          <b className="text-amber-200">Before restoring:</b> close all pol.exe processes. The current login_w.bin will be automatically saved as an emergency backup before being overwritten, so restores are reversible.
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <div className="text-[12px] text-fg-3">Loading backups…</div>}
          {!loading && (entries?.length ?? 0) === 0 && (
            <div className="text-[12px] text-fg-4 italic">No backups found yet. Backups are created automatically when Forest launches accounts, or you can trigger one manually with the "Backup Now" button.</div>
          )}
          {Object.entries(grouped).map(([target, list]) => (
            <div key={target} className="rounded-md border border-line bg-field">
              <div className="px-3 py-2 border-b border-line">
                <div className="text-[10px] font-bold text-fg-4 tracking-wider mb-0.5">TARGET</div>
                <div className="text-[11px] text-fg-2 font-mono break-all">{target}</div>
                <div className="text-[10px] text-fg-4 mt-0.5">{list[0].targetSource}</div>
              </div>
              <div className="divide-y divide-line">
                {list.map((b) => (
                  <div key={b.backupPath} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-fg-2 tabular-nums">
                        {new Date(b.createdUtc).toLocaleString()}
                        {b.isPreRestoreEmergency && <span className="ml-2 text-amber-300 text-[10px]">(pre-restore emergency copy)</span>}
                      </div>
                      <div className="text-[10px] text-fg-4 tabular-nums">{fmtSize(b.sizeBytes)}</div>
                    </div>
                    <Button onClick={() => setPending({ backupPath: b.backupPath, targetPath: b.targetPath })}>
                      {restoringPath === b.backupPath ? 'Restoring…' : 'Restore'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {result && (
            <div className={`rounded-md p-3 text-[11px] ${result.ok ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/40 text-rose-200'}`}>
              {result.text}
              {result.emergencyPath && (
                <div className="mt-1 text-[10px] text-fg-3 font-mono break-all">
                  Previous file saved to: {result.emergencyPath}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-line flex justify-end gap-1.5">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
      {pending && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setPending(null)}>
          <div className="w-[440px] max-w-full rounded-xl bg-surface border border-amber-500/40 shadow-2xl p-4" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-bold text-amber-200 mb-2">Confirm restore</div>
            <div className="text-[12px] text-fg-2 mb-3 leading-relaxed">
              This will overwrite the current <span className="font-mono text-fg">login_w.bin</span> with the selected backup. Forest will first save the current file as an emergency backup so this action is reversible.
            </div>
            <div className="text-[11px] text-fg-3 mb-3">Make sure all pol.exe processes are closed.</div>
            <div className="flex justify-end gap-1.5">
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button variant="accent" onClick={doRestore}>Restore Now</Button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function LogsWarnModal({ onCancel, onContinue, onUploadInstead }:
  { onCancel: () => void; onContinue: () => void; onUploadInstead: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onMouseDown={onCancel}>
      <div className="w-[520px] max-w-[92vw] rounded-xl bg-surface border border-amber-500/40 p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-amber-300 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="text-[13px] font-bold text-amber-200">Warning: raw log files contain personal information</div>
        </div>
        <div className="text-[12px] text-fg-2 leading-relaxed mb-3">
          The files in this folder contain your <b className="text-fg">Windows username</b>, your <b className="text-fg">account/character names</b>, and your <b className="text-fg">Windower/Ashita profile names</b> in plaintext. Do not send them directly to Discord or email.
        </div>
        <div className="text-[12px] text-fg-2 leading-relaxed mb-4">
          Use <b className="text-fg">Upload Diagnostics</b> instead — it packages the same content but sanitizes all identifiers first (account names become <span className="text-fg-3 font-mono">ACCOUNT_1</span>, <span className="text-fg-3 font-mono">ACCOUNT_2</span>, etc.) so it&apos;s safe to share.
        </div>
        <div className="flex justify-end gap-1.5 flex-wrap">
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onContinue}>Open Folder Anyway</Button>
          <Button variant="accent" onClick={onUploadInstead}>Upload Diagnostics Instead</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UpdatesCard({ currentVersion }: { currentVersion: string }) {
  const [snap, setSnap] = useState<UpdateSnapshot | null>(null);

  useEffect(() => {
    api.updateSnapshot().then(setSnap).catch(() => {});
    return subscribe('update.state', (s: UpdateSnapshot) => setSnap(s));
  }, []);

  const kind = snap?.desktop.kind ?? 'idle';
  const ver = snap?.desktop.version;
  const pct = snap?.desktop.total && snap.desktop.total > 0
    ? Math.min(100, Math.round(((snap.desktop.downloaded ?? 0) / snap.desktop.total) * 100))
    : null;

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-fg-2">
          Current version <span className="font-bold text-fg">v{currentVersion}</span>
          {snap?.lastCheckIso && (
            <span className="ml-2 text-[10px] text-fg-4">checked {fmtAgo(snap.lastCheckIso)}</span>
          )}
        </div>
        <Button onClick={() => api.updateCheck()}>{kind === 'checking' ? 'Checking…' : 'Check Now'}</Button>
      </div>

      {kind === 'available' && ver && (
        <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[12px] font-bold text-emerald-200">
              Update available — v{ver}
            </div>
            <div className="flex gap-1.5">
              <Button onClick={() => api.updateSkip(ver)}>Skip</Button>
              <Button variant="accent" onClick={() => api.updateInstall()}>Download &amp; Install</Button>
            </div>
          </div>
          {snap?.desktop.notes && (
            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] text-fg-2 font-mono leading-snug">{snap.desktop.notes}</pre>
          )}
        </div>
      )}

      {kind === 'downloading' && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-fg-3 mb-1">
            <span>Downloading v{ver ?? '?'}…</span>
            <span className="tabular-nums">{pct !== null ? `${pct}%` : fmtBytes(snap?.desktop.downloaded ?? 0)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-field overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
          </div>
        </div>
      )}

      {kind === 'installing' && (
        <div className="mt-3 text-[11px] text-fg-3">Installing v{ver ?? '?'} — Forest will restart automatically.</div>
      )}

      {kind === 'installed' && (
        <div className="mt-3 text-[11px] text-emerald-300">Update staged. Restarting Forest…</div>
      )}

      {kind === 'none' && (
        <div className="mt-3 text-[11px] text-fg-3">Forest is up to date.</div>
      )}

      {kind === 'error' && snap?.desktop.message && (
        <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
          {snap.desktop.message}
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  } catch { return ''; }
}

function DurationPicker({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const inputCls = 'w-16 px-2 py-1 text-[13px] tabular-nums text-fg rounded-md border border-line bg-field focus:outline-none focus:border-accent';
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={0} max={72}
        value={h}
        onChange={(e) => onChange(Math.max(1, (Number(e.target.value) || 0) * 60 + m))}
        className={inputCls}
      />
      <span className="text-[12px] text-fg-3">h</span>
      <input
        type="number" min={0} max={59}
        value={m}
        onChange={(e) => onChange(Math.max(1, h * 60 + (Number(e.target.value) || 0)))}
        className={inputCls}
      />
      <span className="text-[12px] text-fg-3">m</span>
    </div>
  );
}
