using System.IO;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace Forest;

public sealed record LoginBinCandidate(string Path, string Source);

public static class LoginBinBackup
{
    private static readonly string[] PolRegions = { "PlayOnlineUS", "PlayOnlineEU", "PlayOnlineJP" };

    private static string BackupDir =>
        System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Forest", "pol-backups");

    public static IReadOnlyList<LoginBinCandidate> DiscoverPaths(Config cfg)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<LoginBinCandidate>();

        if (cfg.LoginBinPathOverrides != null)
        {
            foreach (var raw in cfg.LoginBinPathOverrides)
            {
                var p = (raw ?? "").Trim();
                if (string.IsNullOrEmpty(p)) continue;
                var full = p;
                try { full = System.IO.Path.GetFullPath(p); } catch { }
                if (!seen.Add(full)) continue;
                result.Add(new LoginBinCandidate(full, File.Exists(full) ? "override" : "override (missing)"));
            }
        }

        foreach (var region in PolRegions)
        {
            string? root = null;
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(
                    $@"SOFTWARE\WOW6432Node\{region}\InstallFolder");
                root = key?.GetValue("1000") as string;
            }
            catch { }
            if (string.IsNullOrEmpty(root)) continue;
            var lb = System.IO.Path.Combine(root!, "usr", "all", "login_w.bin");
            if (!seen.Add(lb)) continue;
            result.Add(new LoginBinCandidate(lb, File.Exists(lb) ? $"registry:{region}" : $"registry:{region} (missing)"));
        }

        return result;
    }

    public static void RunBackup(Config cfg)
    {
        if (!cfg.LoginBinBackupEnabled) return;

        try { Directory.CreateDirectory(BackupDir); }
        catch (Exception ex) { DiagLog.Log("POL-BACKUP: failed to create backup dir: " + ex.Message); return; }

        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        int backed = 0;

        foreach (var c in DiscoverPaths(cfg))
        {
            if (!File.Exists(c.Path)) continue;
            try
            {
                var hash = ShortHash(c.Path);
                var dst = System.IO.Path.Combine(BackupDir, $"login_w__{hash}__{stamp}.bin");
                File.Copy(c.Path, dst, overwrite: false);
                var size = new FileInfo(dst).Length;
                DiagLog.Log($"POL-BACKUP: [{c.Source}] {c.Path} -> {dst} ({size} bytes)");
                backed++;
            }
            catch (Exception ex)
            {
                DiagLog.Log($"POL-BACKUP: failed for {c.Path}: {ex.Message}");
            }
        }

        if (backed == 0)
            DiagLog.Log("POL-BACKUP: no login_w.bin files found to back up (no POL install detected and no override paths set)");

        try { Prune(cfg.LoginBinBackupsKeep); }
        catch (Exception ex) { DiagLog.Log("POL-BACKUP: prune failed: " + ex.Message); }
    }

    private static void Prune(int keep)
    {
        if (keep < 1) keep = 1;
        var files = new DirectoryInfo(BackupDir).GetFiles("login_w__*__*.bin");

        var groups = files.GroupBy(f => {
            var name = f.Name;
            var firstUs = name.IndexOf("__", StringComparison.Ordinal);
            var secondUs = firstUs >= 0 ? name.IndexOf("__", firstUs + 2, StringComparison.Ordinal) : -1;
            return firstUs >= 0 && secondUs > firstUs
                ? name.Substring(firstUs + 2, secondUs - (firstUs + 2))
                : "";
        });

        foreach (var g in groups)
        {
            var sorted = g.OrderByDescending(f => f.LastWriteTimeUtc).ToArray();
            for (int i = keep; i < sorted.Length; i++)
                try { sorted[i].Delete(); } catch { }
        }
    }

    public static string GetBackupDir() => BackupDir;

    public sealed record BackupEntry(string BackupPath, string TargetPath, string TargetSource, DateTime CreatedUtc, long SizeBytes, bool IsPreRestoreEmergency);

    public static IReadOnlyList<BackupEntry> ListBackups(Config cfg)
    {
        var result = new List<BackupEntry>();
        if (!Directory.Exists(BackupDir)) return result;

        var candidates = DiscoverPaths(cfg);
        var hashToTarget = candidates.ToDictionary(
            c => ShortHash(c.Path),
            c => (c.Path, c.Source),
            StringComparer.OrdinalIgnoreCase);

        foreach (var fi in new DirectoryInfo(BackupDir).GetFiles("login_w__*__*.bin"))
        {
            var name = fi.Name;
            var firstUs = name.IndexOf("__", StringComparison.Ordinal);
            var secondUs = firstUs >= 0 ? name.IndexOf("__", firstUs + 2, StringComparison.Ordinal) : -1;
            if (firstUs < 0 || secondUs <= firstUs) continue;
            var hash = name.Substring(firstUs + 2, secondUs - (firstUs + 2));
            var isEmergency = name.Contains("__pre-restore", StringComparison.Ordinal);
            string targetPath = "(unknown POL install)", targetSource = "unmapped";
            if (hashToTarget.TryGetValue(hash, out var t)) { targetPath = t.Path; targetSource = t.Source; }
            result.Add(new BackupEntry(fi.FullName, targetPath, targetSource, fi.LastWriteTimeUtc, fi.Length, isEmergency));
        }

        return result.OrderByDescending(b => b.CreatedUtc).ToList();
    }

    public sealed record RestoreResult(bool Ok, string? EmergencyBackupPath, string? Error);

    public static RestoreResult Restore(Config cfg, string backupPath, string targetPath)
    {
        try
        {
            var normBackup = Path.GetFullPath(backupPath);
            var normTarget = Path.GetFullPath(targetPath);
            var normBackupDir = Path.GetFullPath(BackupDir);

            if (!normBackup.StartsWith(normBackupDir, StringComparison.OrdinalIgnoreCase))
                return new RestoreResult(false, null, "backup path is outside the Forest backups folder");
            if (!File.Exists(normBackup))
                return new RestoreResult(false, null, "backup file no longer exists");

            var validTargets = DiscoverPaths(cfg)
                .Select(c => Path.GetFullPath(c.Path))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (!validTargets.Contains(normTarget))
                return new RestoreResult(false, null, "target is not a currently-discovered login_w.bin path");

            var alivePol = System.Diagnostics.Process.GetProcessesByName("pol");
            if (alivePol.Length > 0)
            {
                foreach (var p in alivePol) { try { p.Dispose(); } catch { } }
                return new RestoreResult(false, null,
                    $"{alivePol.Length} pol.exe process(es) currently running — close them all before restoring (they hold the file open and could re-corrupt after restore)");
            }

            string? emergencyPath = null;
            if (File.Exists(normTarget))
            {
                try { Directory.CreateDirectory(BackupDir); } catch { }
                var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                var hash = ShortHash(normTarget);
                emergencyPath = Path.Combine(BackupDir, $"login_w__{hash}__{stamp}__pre-restore.bin");
                try { File.Copy(normTarget, emergencyPath, overwrite: false); }
                catch (Exception ex) { return new RestoreResult(false, null, "failed to create emergency backup of current file: " + ex.Message); }
            }

            try
            {
                File.Copy(normBackup, normTarget, overwrite: true);
                var restoredSize = new FileInfo(normTarget).Length;
                DiagLog.Log($"POL-RESTORE: {normBackup} -> {normTarget} ({restoredSize} bytes)" +
                            (emergencyPath != null ? $" (previous file saved as {emergencyPath})" : ""));
                return new RestoreResult(true, emergencyPath, null);
            }
            catch (Exception ex)
            {
                return new RestoreResult(false, emergencyPath, "restore copy failed: " + ex.Message);
            }
        }
        catch (Exception ex) { return new RestoreResult(false, null, "restore failed: " + ex.Message); }
    }

    private static string ShortHash(string path)
    {
        using var sha = SHA1.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(path.ToLowerInvariant()));
        return Convert.ToHexString(bytes).Substring(0, 8);
    }
}
