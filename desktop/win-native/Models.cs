using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace PaperTodoDesktop
{
    public sealed class TodoItem
    {
        public int id { get; set; }
        public string title { get; set; }
        public string notes { get; set; }
        public string status { get; set; }
        public string priority { get; set; }
        public string person { get; set; }
        public string source { get; set; }
        public string sourceUrl { get; set; }
        public string due { get; set; }
        public int sortOrder { get; set; }
        public string createdAt { get; set; }
        public string updatedAt { get; set; }
        public string completedAt { get; set; }

        public string Signature()
        {
            return string.Format(
                "{0}|{1}|{2}|{3}|{4}|{5}|{6}",
                title ?? "",
                notes ?? "",
                status ?? "",
                priority ?? "",
                person ?? "",
                due ?? "",
                sourceUrl ?? ""
            );
        }
    }

    public sealed class TodoCounts
    {
        public int inbox { get; set; }
        public int now { get; set; }
        public int todo { get; set; }
        public int waiting { get; set; }
        public int done { get; set; }
        public int active { get; set; }
        public int total { get; set; }
    }

    public sealed class BoardResponse
    {
        public bool changed { get; set; }
        public int revision { get; set; }
        public List<TodoItem> todos { get; set; }
        public TodoCounts counts { get; set; }
        public List<string> people { get; set; }
        public string updatedAt { get; set; }
    }

    public sealed class HealthResponse
    {
        public bool ok { get; set; }
        public string app { get; set; }
        public int revision { get; set; }
    }

    public sealed class PaperTodoApiClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly JavaScriptSerializer _json;
        private readonly string _baseUrl;
        private readonly int _port;
        private readonly string _dataDir;
        private readonly string _serverScriptPath;

        public PaperTodoApiClient(int port, string dataDir, string serverScriptPath)
        {
            _port = port;
            _dataDir = dataDir;
            _serverScriptPath = serverScriptPath;
            _baseUrl = string.Format("http://127.0.0.1:{0}", port);
            _http = new HttpClient();
            _http.Timeout = TimeSpan.FromSeconds(4);
            _json = new JavaScriptSerializer();
            _json.MaxJsonLength = 16 * 1024 * 1024;
        }

        public string BaseUrl
        {
            get { return _baseUrl; }
        }

        public async Task<bool> CheckHealthAsync()
        {
            try
            {
                HttpResponseMessage resp = await _http.GetAsync(_baseUrl + "/api/health").ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode) return false;
                string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                HealthResponse health = _json.Deserialize<HealthResponse>(body);
                return health != null && health.ok && health.app == "paper-todo-mcp";
            }
            catch
            {
                return false;
            }
        }

        public async Task<bool> EnsureBackendAsync()
        {
            if (await CheckHealthAsync().ConfigureAwait(false))
            {
                return true;
            }

            string serverScript = ResolveServerScript();
            if (string.IsNullOrEmpty(serverScript) || !File.Exists(serverScript))
            {
                return false;
            }

            try
            {
                StringBuilder args = new StringBuilder();
                args.Append("--no-warnings \"");
                args.Append(serverScript);
                args.Append("\" --api-only --port ");
                args.Append(_port);
                if (!string.IsNullOrEmpty(_dataDir))
                {
                    args.Append(" --data-dir \"");
                    args.Append(_dataDir);
                    args.Append("\"");
                }

                ProcessStartInfo psi = new ProcessStartInfo("node", args.ToString());
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch
            {
                return false;
            }

            for (int i = 0; i < 25; i++)
            {
                await Task.Delay(120).ConfigureAwait(false);
                if (await CheckHealthAsync().ConfigureAwait(false))
                {
                    return true;
                }
            }
            return false;
        }

        private string ResolveServerScript()
        {
            if (!string.IsNullOrEmpty(_serverScriptPath) && File.Exists(_serverScriptPath))
            {
                return _serverScriptPath;
            }

            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string sibling = Path.Combine(exeDir, "server.mjs");
            if (File.Exists(sibling)) return sibling;

            string parentDist = Path.GetFullPath(Path.Combine(exeDir, "..", "dist", "server.mjs"));
            if (File.Exists(parentDist)) return parentDist;

            return null;
        }

        public async Task<BoardResponse> GetBoardAsync(int? sinceRevision)
        {
            string url = sinceRevision.HasValue
                ? string.Format("{0}/api/board?since={1}", _baseUrl, sinceRevision.Value)
                : _baseUrl + "/api/board";

            HttpResponseMessage resp = await _http.GetAsync(url).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();
            string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            return _json.Deserialize<BoardResponse>(body);
        }

        public async Task<BoardResponse> AddTodoAsync(Dictionary<string, object> payload)
        {
            return await SendJsonAsync(HttpMethod.Post, "/api/todos", payload).ConfigureAwait(false);
        }

        public async Task<BoardResponse> UpdateTodoAsync(int id, Dictionary<string, object> payload)
        {
            return await SendJsonAsync(new HttpMethod("PATCH"), string.Format("/api/todos/{0}", id), payload).ConfigureAwait(false);
        }

        public async Task<BoardResponse> ToggleTodoAsync(int id)
        {
            return await SendJsonAsync(HttpMethod.Post, string.Format("/api/todos/{0}/toggle", id), null).ConfigureAwait(false);
        }

        public async Task<BoardResponse> DeleteTodoAsync(int id)
        {
            return await SendJsonAsync(HttpMethod.Delete, string.Format("/api/todos/{0}", id), null).ConfigureAwait(false);
        }

        public async Task<BoardResponse> ClearCompletedAsync()
        {
            return await SendJsonAsync(HttpMethod.Post, "/api/todos/clear-done", null).ConfigureAwait(false);
        }

        public async Task<BoardResponse> SeedDemoAsync()
        {
            return await SendJsonAsync(HttpMethod.Post, "/api/seed", null).ConfigureAwait(false);
        }

        private async Task<BoardResponse> SendJsonAsync(HttpMethod method, string path, object payload)
        {
            HttpRequestMessage req = new HttpRequestMessage(method, _baseUrl + path);
            if (payload != null)
            {
                string jsonStr = _json.Serialize(payload);
                req.Content = new StringContent(jsonStr, Encoding.UTF8, "application/json");
            }
            HttpResponseMessage resp = await _http.SendAsync(req).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();
            string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            BoardResponse board = _json.Deserialize<BoardResponse>(body);
            if (board != null)
            {
                board.changed = true;
            }
            return board;
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
