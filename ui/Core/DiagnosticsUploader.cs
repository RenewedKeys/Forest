using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Forest;

public static class DiagnosticsUploader
{
    public const string DefaultEndpoint = "https://gnosis-xi.com/api/forest/diagnostics";

    private const string SharedSecret = "forest-diag-v1-7a8c2e6b9d4f1a3c";

    private const long MaxUploadBytes = 25L * 1024 * 1024;

    public sealed record Result(bool Ok, string? Id, string? Url, string? Error);

    public static async Task<Result> UploadAsync(string label)
    {
        var cfg = Config.Load();
        string endpoint = string.IsNullOrWhiteSpace(cfg.DiagnosticsUploadUrl)
            ? DefaultEndpoint
            : cfg.DiagnosticsUploadUrl!.Trim();

        string zipPath;
        try { zipPath = DiagLog.ExportZip(cfg); }
        catch (Exception ex) { return new Result(false, null, null, "Export failed: " + ex.Message); }

        try
        {
            var fi = new FileInfo(zipPath);
            if (!fi.Exists) return new Result(false, null, null, "Diagnostics zip missing after export");
            if (fi.Length > MaxUploadBytes)
                return new Result(false, null, null, $"Zip is {fi.Length / 1024 / 1024} MB; max upload is {MaxUploadBytes / 1024 / 1024} MB");

            byte[] body = await File.ReadAllBytesAsync(zipPath).ConfigureAwait(false);
            string safeLabel = SanitizeLabel(label);
            string version = UpdateManager.GetCurrentVersion();
            string ts = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            string sig = HmacHex(SharedSecret, body, safeLabel, ts, version);

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | SecurityProtocolType.Tls13;
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            client.DefaultRequestHeaders.Add("User-Agent", "Forest-Diagnostics/" + version);
            client.DefaultRequestHeaders.Add("X-Forest-Version", version);
            client.DefaultRequestHeaders.Add("X-Forest-Label", safeLabel);
            client.DefaultRequestHeaders.Add("X-Forest-Timestamp", ts);
            client.DefaultRequestHeaders.Add("X-Forest-Signature", sig);

            using var content = new ByteArrayContent(body);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");

            using var resp = await client.PostAsync(endpoint, content).ConfigureAwait(false);
            string respBody = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (!resp.IsSuccessStatusCode)
            {
                DiagLog.Log($"Diagnostics upload HTTP {(int)resp.StatusCode}: {Truncate(respBody, 200)}");
                return new Result(false, null, null, $"Server returned {(int)resp.StatusCode}");
            }

            string? id = null, url = null;
            try
            {
                using var doc = JsonDocument.Parse(respBody);
                if (doc.RootElement.TryGetProperty("id", out var idv)) id = idv.GetString();
                if (doc.RootElement.TryGetProperty("url", out var uv)) url = uv.GetString();
            }
            catch { }

            DiagLog.Log($"Diagnostics uploaded ({fi.Length / 1024} KB) label='{safeLabel}' id={id ?? "?"}");
            return new Result(true, id, url, null);
        }
        catch (Exception ex)
        {
            DiagLog.Log("Diagnostics upload failed: " + ex.Message);
            return new Result(false, null, null, ex.Message);
        }
    }

    private static string SanitizeLabel(string label)
    {
        string s = (label ?? "").Trim();
        if (s.Length == 0) s = "unnamed";
        s = Regex.Replace(s, @"[^A-Za-z0-9._\- ]", "");
        s = Regex.Replace(s, @"\s+", "-");
        if (s.Length > 60) s = s.Substring(0, 60);
        if (s.Length == 0) s = "unnamed";
        return s;
    }

    private static string HmacHex(string secret, byte[] body, string label, string ts, string version)
    {
        byte[] key = Encoding.UTF8.GetBytes(secret);
        byte[] header = Encoding.UTF8.GetBytes($"{label}|{ts}|{version}|");
        using var hmac = new HMACSHA256(key);
        hmac.TransformBlock(header, 0, header.Length, null, 0);
        hmac.TransformFinalBlock(body, 0, body.Length);
        return Convert.ToHexString(hmac.Hash!).ToLowerInvariant();
    }

    private static string Truncate(string s, int n) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= n ? s : s.Substring(0, n) + "...");
}
