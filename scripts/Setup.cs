using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
using System.Threading.Tasks;

class Setup {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();
        string target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","ISPBlockMaker");
        bool unpack = args.Length == 2 && args[0] == "--extract";
        if (unpack) target=Path.GetFullPath(args[1]);
        else if(MessageBox.Show("ISP Block Maker와 전용 Node를 설치하고 사용자 PATH에 실행 명령을 등록합니다.\n\n"+target+"\n\n계속하시겠습니까?","ISP Block Maker 설치",MessageBoxButtons.OKCancel)!=DialogResult.OK) return;
        var window=new Form {Text="ISP Block Maker 설치",Width=480,Height=140};
        window.Controls.Add(new Label {Text="파일을 준비하고 있습니다…",Dock=DockStyle.Fill,Padding=new Padding(20)});
        bool done=false;
        window.FormClosing+=(s,e)=>{if(!done)e.Cancel=true;};
        window.Shown+=async(s,e)=>{
            if(unpack) window.Hide();
            try {
                await Task.Run(()=>{
                    Directory.CreateDirectory(target);
                    using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                    using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
                        foreach(var entry in zip.Entries) {
                            string file=Path.GetFullPath(Path.Combine(target,entry.FullName));
                            if(!file.StartsWith(target.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid package path");
                            if(entry.FullName.EndsWith("/")) {Directory.CreateDirectory(file);continue;}
                            Directory.CreateDirectory(Path.GetDirectoryName(file));
                            using(var input=entry.Open()) using(var output=File.Create(file)) input.CopyTo(output);
                        }
                    }
                    if(!unpack) {
                        var info=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(target,"install.ps1")+"\"") {UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true};
                        using(var child=Process.Start(info)) {string error=child.StandardError.ReadToEnd();child.WaitForExit();if(child.ExitCode!=0)throw new Exception(error);}
                    }
                });
                if(!unpack) MessageBox.Show("설치 완료. 새 터미널에서 작업 폴더로 이동한 뒤:\n\nisp-block-maker .\n\n또는 시작 메뉴의 ISP Block Maker를 실행하세요.","ISP Block Maker");
            } catch(Exception error) {Environment.ExitCode=1;if(!unpack)MessageBox.Show(error.Message,"설치 실패");}
            finally {done=true;window.Close();}
        };
        Application.Run(window);
    }
}
