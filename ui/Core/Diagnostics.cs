using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace Forest;

public static class Diagnostics
{
    private static readonly Dictionary<string, string> KnownAv = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MsMpEng"]        = "Windows Defender",
        ["NisSrv"]         = "Windows Defender",
        ["SecurityHealthService"] = "Windows Security",
        ["mbam"]           = "Malwarebytes",
        ["MBAMService"]    = "Malwarebytes",
        ["mbamtray"]       = "Malwarebytes",
        ["ekrn"]           = "ESET",
        ["egui"]           = "ESET",
        ["avp"]            = "Kaspersky",
        ["kavtray"]        = "Kaspersky",
        ["bdagent"]        = "Bitdefender",
        ["vsserv"]         = "Bitdefender",
        ["AvastSvc"]       = "Avast",
        ["AvastUI"]        = "Avast",
        ["AVGSvc"]         = "AVG",
        ["AVGUI"]          = "AVG",
        ["NortonSecurity"] = "Norton",
        ["NS"]             = "Norton",
        ["ccSvcHst"]       = "Symantec",
        ["SmcGui"]         = "Symantec",
        ["HitmanPro"]      = "HitmanPro",
        ["TmListen"]       = "Trend Micro",
        ["TmProxy"]        = "Trend Micro",
        ["McShield"]       = "McAfee",
        ["mcafee"]         = "McAfee",
        ["CmdAgent"]       = "Comodo",
        ["cmdguard"]       = "Comodo",
        ["SAVService"]     = "Sophos",
        ["SophosUI"]       = "Sophos",
        ["fshoster"]       = "F-Secure",
        ["fsavd"]          = "F-Secure",
        ["GData"]          = "G Data",
        ["AVKWCtl"]        = "G Data",
        ["FortiClient"]    = "FortiClient",
        ["FCAuth"]         = "FortiClient",
        ["CrowdStrike"]    = "CrowdStrike",
        ["CSFalconService"] = "CrowdStrike",
        ["SentinelAgent"]  = "SentinelOne",
        ["SentinelHelperService"] = "SentinelOne",
        ["MsSense"]        = "Defender for Endpoint",
        ["CylanceSvc"]     = "Cylance",
        ["WRSA"]           = "Webroot",
    };

    public static void LogStartupSnapshot()
    {
        try { LogAvProducts(); } catch (Exception ex) { DiagLog.Log("AV-SCAN failed: " + ex.Message); }
        try { LogTokenInfo();  } catch (Exception ex) { DiagLog.Log("TOKEN-INFO failed: " + ex.Message); }
        _ = Task.Run(async () => { try { await LogClockSkewAsync(); } catch (Exception ex) { DiagLog.Log("CLOCK-SKEW failed: " + ex.Message); } });
    }

    private static void LogAvProducts()
    {
        var found = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (KnownAv.TryGetValue(p.ProcessName, out var label))
                        found.Add(label);
                }
                catch { }
                finally { try { p.Dispose(); } catch { } }
            }
        }
        catch (Exception ex) { DiagLog.Log("AV-SCAN enumerate failed: " + ex.Message); return; }

        if (found.Count == 0)
            DiagLog.Log("AV-DETECTED: (none recognized; user may still have something running)");
        else
            DiagLog.Log("AV-DETECTED: " + string.Join(", ", found));

        try
        {
            using var rtp = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows Defender\Real-Time Protection");
            if (rtp != null)
            {
                var disabled = rtp.GetValue("DisableRealtimeMonitoring");
                var disableBehavior = rtp.GetValue("DisableBehaviorMonitoring");
                DiagLog.Log($"DEFENDER-RTP: DisableRealtimeMonitoring={disabled ?? "(unset)"} DisableBehaviorMonitoring={disableBehavior ?? "(unset)"}");
            }
        }
        catch { }
    }

    private static void LogTokenInfo()
    {
        using var id = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(id);
        bool admin = principal.IsInRole(WindowsBuiltInRole.Administrator);
        string il = GetIntegrityLevel(id);
        DiagLog.Log($"TOKEN: user='{id.Name}' admin={admin} integrity={il} authType={id.AuthenticationType ?? "(null)"}");

        bool hasDebug = HasSeDebugPrivilege();
        DiagLog.Log($"TOKEN-PRIV: SeDebugPrivilege={(hasDebug ? "enabled" : "absent_or_disabled")}");
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, IntPtr TokenInformation, uint TokenInformationLength, out uint ReturnLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint nSubAuthority);

    private const int TokenIntegrityLevel = 25;

    private static string GetIntegrityLevel(WindowsIdentity id)
    {
        try
        {
            uint needed = 0;
            GetTokenInformation(id.Token, TokenIntegrityLevel, IntPtr.Zero, 0, out needed);
            if (needed == 0) return "(unknown)";
            IntPtr buf = Marshal.AllocHGlobal((int)needed);
            try
            {
                if (!GetTokenInformation(id.Token, TokenIntegrityLevel, buf, needed, out _)) return "(unknown)";
                IntPtr pSid = Marshal.ReadIntPtr(buf);
                IntPtr countPtr = GetSidSubAuthorityCount(pSid);
                if (countPtr == IntPtr.Zero) return "(unknown)";
                byte count = Marshal.ReadByte(countPtr);
                IntPtr lastSub = GetSidSubAuthority(pSid, (uint)(count - 1));
                if (lastSub == IntPtr.Zero) return "(unknown)";
                uint rid = (uint)Marshal.ReadInt32(lastSub);
                return rid switch
                {
                    0     => "Untrusted",
                    4096  => "Low",
                    8192  => "Medium",
                    8448  => "Medium+",
                    12288 => "High",
                    16384 => "System",
                    20480 => "ProtectedProcess",
                    _     => $"0x{rid:X}",
                };
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        catch { return "(unknown)"; }
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool LookupPrivilegeValue(string? lpSystemName, string lpName, out long lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool PrivilegeCheck(IntPtr ClientToken, ref PRIVILEGE_SET RequiredPrivileges, out bool pfResult);

    [StructLayout(LayoutKind.Sequential)]
    private struct PRIVILEGE_SET { public uint PrivilegeCount; public uint Control; public long LuidLow; public uint Attributes; }

    private const uint PRIVILEGE_SET_ALL_NECESSARY = 1;

    private static bool HasSeDebugPrivilege()
    {
        try
        {
            if (!LookupPrivilegeValue(null, "SeDebugPrivilege", out var luid)) return false;
            var set = new PRIVILEGE_SET
            {
                PrivilegeCount = 1,
                Control = PRIVILEGE_SET_ALL_NECESSARY,
                LuidLow = luid,
                Attributes = 0,
            };
            using var id = WindowsIdentity.GetCurrent();
            if (!PrivilegeCheck(id.Token, ref set, out var result)) return false;
            return result;
        }
        catch { return false; }
    }

    public static double? LastClockSkewSeconds { get; private set; }
    public static DateTime? LastClockSkewAt { get; private set; }

    public static async Task LogClockSkewAsync()
    {
        string[] probes = { "https://www.cloudflare.com", "https://www.google.com" };
        foreach (var url in probes)
        {
            try
            {
                using var c = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };
                c.DefaultRequestHeaders.Add("User-Agent", "Forest-ClockProbe");
                var req = new HttpRequestMessage(HttpMethod.Head, url);
                var localBefore = DateTime.UtcNow;
                using var resp = await c.SendAsync(req).ConfigureAwait(false);
                var localAfter = DateTime.UtcNow;
                var serverDate = resp.Headers.Date;
                if (serverDate is null) continue;
                var localMid = localBefore + (localAfter - localBefore) / 2;
                var skew = (localMid - serverDate.Value.UtcDateTime).TotalSeconds;
                string note = Math.Abs(skew) > 15
                    ? " (WARNING: >15s skew can cause OTP rejection at SE)"
                    : (Math.Abs(skew) > 3 ? " (moderate)" : " (ok)");
                DiagLog.Log($"CLOCK-SKEW: local-vs-{new Uri(url).Host}={skew:+0.00;-0.00}s{note}");
                LastClockSkewSeconds = skew;
                LastClockSkewAt = DateTime.UtcNow;
                return;
            }
            catch { }
        }
        DiagLog.Log("CLOCK-SKEW: all probes failed (no internet?)");
        LastClockSkewSeconds = null;
        LastClockSkewAt = DateTime.UtcNow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint STILL_ACTIVE = 259;

    public static uint? GetExitCode(int pid)
    {
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            if (!GetExitCodeProcess(h, out var code)) return null;
            return code == STILL_ACTIVE ? null : code;
        }
        finally { CloseHandle(h); }
    }

    public static void DumpTcpConnections(string profile, int pid)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName  = "netstat.exe",
                Arguments = "-ano -p TCP",
                RedirectStandardOutput = true,
                UseShellExecute  = false,
                CreateNoWindow   = true,
                StandardOutputEncoding = Encoding.UTF8,
            };
            using var p = Process.Start(psi);
            if (p == null) { DiagLog.Log($"NETSTAT [{profile}] pid={pid}: failed to launch netstat"); return; }
            string output = p.StandardOutput.ReadToEnd();
            if (!p.WaitForExit(8000)) { try { p.Kill(); } catch { } DiagLog.Log($"NETSTAT [{profile}] pid={pid}: timed out"); return; }

            string pidStr = pid.ToString();
            var matched = new List<string>();
            foreach (var raw in output.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.EndsWith(" " + pidStr) || line.EndsWith("\t" + pidStr))
                    matched.Add(line);
            }
            if (matched.Count == 0)
            {
                DiagLog.Log($"NETSTAT [{profile}] pid={pid}: no active TCP connections");
                return;
            }
            DiagLog.Log($"NETSTAT [{profile}] pid={pid}: {matched.Count} connection(s) (state suspected stuck)");
            foreach (var m in matched.Take(20))
                DiagLog.Log($"  {m}");
            if (matched.Count > 20) DiagLog.Log($"  ... and {matched.Count - 20} more");
        }
        catch (Exception ex) { DiagLog.Log($"NETSTAT [{profile}] pid={pid}: failed: {ex.Message}"); }
    }
}
