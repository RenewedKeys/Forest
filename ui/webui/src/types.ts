// Mirrors Forest's Core data model (Config / CredentialStore.Account / launch status).
// Kept in lockstep with the C# bridge handlers.

export type Launcher = 'Default' | 'Windower' | 'Ashita';

export interface Account {
  profile: string;     // account name (unique key)
  windower: string;    // Windower profile name OR Ashita boot .ini
  polSlot: number;     // POL member-list slot 1-20, 0 = unset (manual)
  ingameSlot: number;  // FFXI character slot 1-16, 0 = first
  launcher: Launcher;  // per-account launcher, 'Default' falls back to config
  launchArgs: string;  // custom args, '' = use launcher default template
  launcherExe: string; // per-account launcher exe override, '' = use global Settings path
  hasTotp: boolean;    // whether a TOTP secret is stored (the secret itself never crosses the bridge)
}

// Friendly launch states shown on the account row.
// 'LOGIN COMPLETE' is splash-only: the AutoLaunchSplash component substitutes
// it for the underlying RUNNING state when all watched accounts are fully in
// game, during the auto-quit settle countdown. Backend never sets it.
export type LaunchState =
  | 'INACTIVE' | 'QUEUED'
  | 'LAUNCH WINDOWER' | 'LAUNCH ASHITA' | 'LAUNCH POL' | 'SELECT ACCOUNT'
  | 'INPUT PASSWORD' | 'LOGGING IN' | 'LAUNCHING GAME'
  | 'RUNNING' | 'DONE' | 'LOGIN COMPLETE'
  | 'FAILED' | 'WRONG SE PASSWORD' | 'LOGIN STUCK' | 'TIMEOUT' | 'TERMINATED'
  | 'DISCONNECTED';

export interface AccountStatus {
  profile: string;
  pid: number;          // pol.exe pid, 0 = none
  status: LaunchState;
  countdownSeconds?: number | null;       // seconds until termination (lower of auto + manual)
  countdownTotalSeconds?: number | null;  // original duration, for heat-color ratio
  countdownSource?: 'auto' | 'manual' | null;
}

export interface Config {
  windowerExe: string;
  ashitaExe: string;
  treesDir: string;
  defaultLauncher: 'Windower' | 'Ashita';
  windowerArgs: string;
  ashitaArgs: string;
  staggerSeconds: number;
  fastSequential: boolean;
  loginTimeoutSeconds: number;
  hidePolWindow: boolean;
  disableAutoLogin: boolean;
  usePolProxy: boolean;
  polProxyUpstream: string;
  launchSelectedOnStartup: boolean;
  autoLoginCharacter: boolean;
  autoLoginSettleSeconds: number;
  autoLoginSendInputFallback: boolean;
  waitForFFXiRegistryReadBetweenLaunches: boolean;
  waitForFFXiRegistryReadTimeoutSeconds: number;
  overrideFFXiResolution: boolean;
  launchMode: 'Full' | 'Splash';
  debugLogging: boolean;
  autoTerminateEnabled: boolean;
  autoTerminateMinutes: number;
  minSecondsBetweenLaunches: number;
  checkUpdatesOnStartup: boolean;
  skippedUpdateVersion: string;
  diagnosticsUploadUrl: string;
  currentVersion: string;
  clockSkewSeconds: number | null;
  loginBinBackupEnabled: boolean;
  loginBinBackupsKeep: number;
  loginBinPathOverrides: string[];
  selectedAccounts: string[];
  accountOrder: string[];
  // Read-only: emitted by the bridge, ignored on patch. Reflects whether
  // the Forest process is running with Windows administrator rights.
  isElevated: boolean;
}

export type UpdateKind =
  | 'idle' | 'checking' | 'available' | 'none'
  | 'downloading' | 'installing' | 'installed' | 'error';

export interface UpdateChannel {
  kind: UpdateKind;
  version?: string | null;
  notes?: string | null;
  url?: string | null;
  downloaded?: number;
  total?: number | null;
  message?: string | null;
}

export interface UpdateSnapshot {
  desktop: UpdateChannel;
  currentVersion: string;
  checkOnStartup: boolean;
  lastCheckIso?: string | null;
}

export interface DiagUploadResult {
  ok: boolean;
  id?: string | null;
  url?: string | null;
  error?: string | null;
}

export interface PolBackupCandidate {
  path: string;
  source: string;
  exists: boolean;
}

export interface PolBackupDiscovery {
  paths: PolBackupCandidate[];
  backupDir: string;
}

export interface PolBackupEntry {
  backupPath: string;
  targetPath: string;
  targetSource: string;
  createdUtc: string;
  sizeBytes: number;
  isPreRestoreEmergency: boolean;
}

export interface PolRestoreResult {
  ok: boolean;
  emergencyBackupPath?: string | null;
  error?: string | null;
}

// Payload for creating/updating an account. `password`/`totpSecret` are write-only
// (sent to C# to DPAPI-encrypt); omit/blank on edit to keep the existing value.
export interface AccountSave {
  profile: string;
  originalProfile?: string; // set when renaming
  windower: string;
  polSlot: number;
  ingameSlot: number;
  launcher: Launcher;
  launchArgs: string;
  launcherExe?: string;     // optional per-account launcher exe override
  password?: string;
  totpSecret?: string;
  clearTotp?: boolean;
}

export interface StaleProc {
  pid: number;
  profile: string;
  slot: number;
}
