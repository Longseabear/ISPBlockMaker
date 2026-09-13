using System;
using System.IO;
using System.Net;
using System.Text;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// Uses the Windows .NET Framework; no Electron or npm install on the receiving PC.
class Launcher : Form {
    readonly string root, url, log;
    readonly Label status = new Label { Dock = DockStyle.Fill, Padding = new Padding(15), AutoSize = false };
    readonly Button start = new Button { Text = "시작 / 브라우저 열기", AutoSize = true };
    readonly Button stop = new Button { Text = "서버 종료", AutoSize = true };
    Process child;
    string instance;
    bool busy, closing;
    readonly bool smoke;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    readonly object logLock = new object();
    Launcher(string folder, int port, bool selfTest) {
        smoke = selfTest;
        root = Path.GetFullPath(folder); url = "http://127.0.0.1:" + port;
        string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ISPBlockMaker", "logs");
        Directory.CreateDirectory(logDir);
        log = Path.Combine(logDir, "launcher-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Process.GetCurrentProcess().Id + ".log");
        Text = "ISP Block Maker"; Size = new Size(580, 250); MinimumSize = Size;
        var row = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 55, Padding = new Padding(10) };
        var logs = new Button { Text = "로그 폴더", AutoSize = true };
        row.Controls.AddRange(new Control[] { start, stop, logs }); Controls.Add(status); Controls.Add(row);
        start.Click += async (s,e) => await Run(port);
        stop.Click += async (s,e) => await Stop();
        logs.Click += (s,e) => Process.Start("explorer.exe", Path.GetDirectoryName(log));
        Shown += async (s,e) => {
            if(smoke) Hide();
            await Run(port);
            if(smoke) { if(instance==null) Environment.ExitCode=1; await Stop(); closing=true; Close(); }
        };
        FormClosing += async (s,e) => {
            if (closing) return;
            e.Cancel = true;
            if (busy) { status.Text = "시작/종료 작업 완료 후 닫아주세요."; return; }
            await Stop(); closing = true; Close();
        };
    }
    void WriteLog(string value) { if (value != null) lock(logLock) File.AppendAllText(log, DateTime.Now.ToString("s") + " " + value + Environment.NewLine, Encoding.UTF8); }
    Dictionary<string,object> Request(string route, string body, string token) {
        var req = (HttpWebRequest)WebRequest.Create(url + route); req.Proxy = null; req.Timeout = 2000; req.ReadWriteTimeout = 2000; req.AllowAutoRedirect = false;
        if (token != null) req.Headers["Authorization"] = "Bearer " + token;
        if (body != null) { req.Method = "POST"; req.ContentType = "application/json"; byte[] bytes = Encoding.UTF8.GetBytes(body); req.ContentLength = bytes.Length; using(var stream=req.GetRequestStream()) stream.Write(bytes,0,bytes.Length); }
        using(var res = req.GetResponse()) using(var reader = new StreamReader(res.GetResponseStream())) return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
    }
    Dictionary<string,object> Health() {
        try { return Request("/health", null, null); }
        catch(WebException e) {
            var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, new Uri(url).Port);
            try { probe.Start(); return null; }
            catch(System.Net.Sockets.SocketException) { throw new Exception("포트에 다른 서버가 있거나 응답이 없습니다. " + url, e); }
            finally { probe.Stop(); }
        }
    }
    void Verify(Dictionary<string,object> health) {
        if (!health.ContainsKey("app") || (string)health["app"] != "ISPBlockMaker" || !health.ContainsKey("root") || !String.Equals(Path.GetFullPath((string)health["root"]), root, StringComparison.OrdinalIgnoreCase)) throw new Exception("이 포트는 다른 앱/프레임워크가 사용 중입니다. 해당 앱을 종료하거나 PORT를 변경하세요.");
    }
    string Node() {
        string bundled = Path.Combine(root,"node.exe"); if (File.Exists(bundled)) return bundled;
        foreach(string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            try { string file = Path.Combine(dir.Trim('"'), "node.exe"); if(Path.IsPathRooted(file) && File.Exists(file)) return file; } catch(ArgumentException) {}
        }
        throw new Exception("Node.js를 찾을 수 없습니다. 배포 폴더에 node.exe를 넣거나 Node.js 24 이상을 설치하세요.");
    }
    async Task Run(int port) {
        if (busy) return; busy = true; start.Enabled = stop.Enabled = false; status.Text = "실행 환경과 서버 상태를 확인하고 있습니다…";
        try {
            await Task.Run(async () => {
                var health = Health();
                if(smoke && health!=null) throw new Exception("Self-test requires an unused port; existing server was left running.");
                if (health == null) {
                    if (!File.Exists(Path.Combine(root,"scripts","start-local.mjs"))) throw new Exception("프레임워크 파일이 없습니다. EXE를 프레임워크 폴더에 두세요.");
                    var info = new ProcessStartInfo(Node(), "\"" + Path.Combine(root,"scripts","start-local.mjs") + "\"") { WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true, StandardOutputEncoding=Encoding.UTF8, StandardErrorEncoding=Encoding.UTF8 };
                    info.EnvironmentVariables["PORT"] = port.ToString();
                    child = new Process { StartInfo=info }; child.OutputDataReceived += (s,e) => WriteLog(e.Data); child.ErrorDataReceived += (s,e) => WriteLog(e.Data);
                    child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                    for(int i=0;i<60;i++) { await Task.Delay(500); if(child.HasExited) throw new Exception("서버 시작 실패. 로그에서 의존성·폴더 권한·터미널 진단을 확인하세요."); health=Health(); if(health!=null) break; }
                    if(health==null) throw new Exception("서버 시작 시간 초과. 로그를 확인하세요.");
                }
                Verify(health); instance=(string)health["instance"];
            });
            status.Text = "실행 중 · " + url + "\n" + root + "\n\n이 창을 닫으면 서버와 터미널이 종료됩니다.";
            if(!smoke) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        } catch(Exception e) { WriteLog(e.Message); status.Text=e.Message+"\n\n로그: "+log; KillChild(); }
        finally { busy=false; start.Enabled=stop.Enabled=true; }
    }
    void KillChild() {
        if(child==null) return;
        try { if(!child.HasExited) { var kill=Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + child.Id + " /T /F") {UseShellExecute=false,CreateNoWindow=true}); kill.WaitForExit(5000); } } catch(Exception e) { WriteLog(e.Message); }
        child.Dispose(); child=null;
    }
    async Task Stop() {
        if(busy) return; busy=true; start.Enabled=stop.Enabled=false;
        try {
            await Task.Run(() => {
                if(instance!=null) {
                    var health=Health();
                    if(health!=null) {
                        Verify(health);
                        if((string)health["instance"]!=instance) throw new Exception("서버가 교체되어 종료하지 않았습니다.");
                        var bootstrap=Request("/api/bootstrap",null,null);
                        Request("/api/shutdown",Json.Serialize(new {instance=instance}),(string)bootstrap["token"]);
                        if(child!=null) child.WaitForExit(5000);
                    }
                }
                KillChild(); instance=null;
            }); status.Text="서버가 종료되었습니다. 시작 버튼으로 다시 실행할 수 있습니다.";
        } catch(Exception e) { WriteLog(e.Message); status.Text=e.Message; if(smoke) Environment.ExitCode=1; KillChild(); }
        finally { busy=false; start.Enabled=stop.Enabled=true; }
    }
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        string root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        int port; if(!Int32.TryParse(Environment.GetEnvironmentVariable("PORT") ?? "4310",out port) || port<1 || port>65535) { MessageBox.Show("PORT must be 1–65535"); return; }
        string key; using(var sha=System.Security.Cryptography.SHA256.Create()) key=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()+":"+port))).Replace("-","");
        bool first;
        using(var mutex=new Mutex(true,"Local\\ISPBlockMaker-"+key,out first)) {
            if(!first) { Process.Start(new ProcessStartInfo("http://127.0.0.1:"+port) {UseShellExecute=true}); return; }
            try { Application.Run(new Launcher(root,port,Array.IndexOf(args,"--self-test")>=0)); } catch(Exception e) { Environment.ExitCode=1; MessageBox.Show(e.Message,"ISP Block Maker"); }
        }
    }
}
