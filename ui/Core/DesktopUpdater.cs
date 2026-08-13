using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows;

namespace Forest;

public static class DesktopUpdater
{
    public static void StageAndLaunch(string zipPath, string version)
    {
        if (!File.Exists(zipPath))
            throw new InvalidOperationException("Downloaded zip not found: " + zipPath);

        string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string exePath    = Process.GetCurrentProcess().MainModule?.FileName
                            ?? Assembly.GetExecutingAssembly().Location;

        string baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Forest", "updates");
        string stagingDir = Path.Combine(baseDir, "stage-" + version);
        if (Directory.Exists(stagingDir)) Directory.Delete(stagingDir, true);
        Directory.CreateDirectory(stagingDir);

        ZipFile.ExtractToDirectory(zipPath, stagingDir);

        string root = FindStagingRoot(stagingDir);

        string cmdPath = Path.Combine(baseDir, "forest-update-" + version + ".cmd");
        int pid = Process.GetCurrentProcess().Id;

        string script =
            "@echo off\r\n" +
            "setlocal\r\n" +
            "set PID=" + pid + "\r\n" +
            "set SRC=" + Quote(root) + "\r\n" +
            "set DST=" + Quote(installDir) + "\r\n" +
            "set EXE=" + Quote(exePath) + "\r\n" +
            ":wait\r\n" +
            "tasklist /FI \"PID eq %PID%\" 2>NUL | find /I \"%PID%\" >NUL\r\n" +
            "if not errorlevel 1 (\r\n" +
            "  timeout /t 1 /nobreak >NUL\r\n" +
            "  goto wait\r\n" +
            ")\r\n" +
            "robocopy %SRC% %DST% /E /R:2 /W:1 /NFL /NDL /NJH /NJS >NUL\r\n" +
            "start \"\" %EXE%\r\n" +
            "rmdir /S /Q %SRC% >NUL 2>NUL\r\n" +
            "del \"%~f0\"\r\n";

        File.WriteAllText(cmdPath, script);

        var psi = new ProcessStartInfo
        {
            FileName        = "cmd.exe",
            Arguments       = "/c \"" + cmdPath + "\"",
            CreateNoWindow  = true,
            UseShellExecute = false,
            WindowStyle     = ProcessWindowStyle.Hidden,
        };
        Process.Start(psi);

        ThreadPool.QueueUserWorkItem(_ =>
        {
            Thread.Sleep(750);
            try
            {
                Application.Current?.Dispatcher?.Invoke(() => Application.Current.Shutdown());
            }
            catch { Environment.Exit(0); }
        });
    }

    private static string FindStagingRoot(string stagingDir)
    {
        if (File.Exists(Path.Combine(stagingDir, "Forest.exe")))
            return stagingDir;
        foreach (string sub in Directory.GetDirectories(stagingDir))
        {
            if (File.Exists(Path.Combine(sub, "Forest.exe")))
                return sub;
        }
        throw new InvalidOperationException(
            "Forest.exe not found in extracted zip - the zip layout is unexpected.");
    }

    private static string Quote(string p) => "\"" + p + "\"";
}
