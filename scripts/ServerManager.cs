using System;
using System.IO;
using System.Net;
using System.Text;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// One native server-control window per user state directory; work UIs stay in their own browser pages.
class ServerManager : Form {
    readonly string root, initialFolder;
    readonly ListView projects=new ListView {Dock=DockStyle.Fill,View=View.Details,FullRowSelect=true,MultiSelect=false,HideSelection=false};
    readonly Label status=new Label {Dock=DockStyle.Bottom,Height=55,Padding=new Padding(12)};
    readonly Button open=new Button {Text="시작 / 웹 열기",AutoSize=true};
    readonly Button stop=new Button {Text="선택 서버 종료",AutoSize=true};
    readonly Button add=new Button {Text="폴더 열기…",AutoSize=true};
    readonly Button refresh=new Button {Text="새로고침",AutoSize=true};
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer {Interval=3000};
    string url,token;int selection=-1;bool busy, polling;
    static JavaScriptSerializer Json {get{return new JavaScriptSerializer();}}

    public static Dictionary<string,object> SendOpen(string root,string folder) {
        string node=Path.Combine(root,"node.exe");if(!File.Exists(node))node="node.exe";
        var info=new ProcessStartInfo(node,"\""+Path.Combine(root,"server","hub.mjs")+"\" --open") {WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
        info.EnvironmentVariables["ISP_MANAGER_FOLDER"]=folder;
        using(var child=Process.Start(info)) {
            var errors=child.StandardError.ReadToEndAsync();
            string output=child.StandardOutput.ReadToEnd();
            child.WaitForExit();
            if(child.ExitCode!=0)throw new Exception(errors.Result);
            return Json.Deserialize<Dictionary<string,object>>(output);
        }
    }
    Dictionary<string,object> Request(string route,object body=null) {
        var req=(HttpWebRequest)WebRequest.Create(url+route);req.Proxy=null;req.AllowAutoRedirect=false;req.Timeout=route=="/api/shutdown"?2000:120000;req.ReadWriteTimeout=req.Timeout;
        if(token!=null)req.Headers["Authorization"]="Bearer "+token;
        if(body!=null){req.Method="POST";req.ContentType="application/json";byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(body));req.ContentLength=bytes.Length;using(var stream=req.GetRequestStream())stream.Write(bytes,0,bytes.Length);}
        try{using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());}
        catch(WebException e){if(e.Response==null)throw;using(var reader=new StreamReader(e.Response.GetResponseStream())){var error=Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());throw new Exception(Convert.ToString(error["error"]));}}
    }
    public ServerManager(string appRoot,string folder) {
        root=appRoot;initialFolder=folder;
        Text="ISP Block Maker · 서버 관리";Size=new Size(1050,520);MinimumSize=new Size(780,360);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);
        var heading=new Label {Text="ISP Block Maker  /  실행 중 · 최근 프로젝트",Dock=DockStyle.Top,Height=60,Padding=new Padding(16),Font=new Font("Segoe UI",14,FontStyle.Bold)};
        var actions=new FlowLayoutPanel {Dock=DockStyle.Bottom,Height=58,Padding=new Padding(12)};
        actions.Controls.AddRange(new Control[]{add,open,stop,refresh});
        projects.Columns.Add("프로젝트",165);projects.Columns.Add("상태",90);projects.Columns.Add("서버 주소",205);projects.Columns.Add("폴더",550);
        Controls.Add(projects);Controls.Add(status);Controls.Add(actions);Controls.Add(heading);
        status.Text="서버 목록을 확인하고 있습니다…";
        open.Click+=async(s,e)=>await OpenSelected();projects.DoubleClick+=async(s,e)=>await OpenSelected();
        add.Click+=async(s,e)=>{using(var picker=new FolderBrowserDialog {Description="ISP 작업 폴더",ShowNewFolderButton=true})if(picker.ShowDialog(this)==DialogResult.OK)await OpenFolder(picker.SelectedPath);};
        stop.Click+=async(s,e)=>await StopSelected();refresh.Click+=async(s,e)=>await Poll();timer.Tick+=async(s,e)=>await Poll();
        Shown+=async(s,e)=>{await OpenFolder(initialFolder);timer.Start();};
        FormClosing+=(s,e)=>{if(busy){e.Cancel=true;status.Text="시작/종료 작업이 끝난 후 닫아주세요.";return;}timer.Stop();};
        FormClosed+=(s,e)=>{if(url!=null)try{var health=Request("/health");Request("/api/shutdown",new {instance=health["instance"]});}catch{}};
    }
    Dictionary<string,object> Selected(){return projects.SelectedItems.Count==0?null:(Dictionary<string,object>)projects.SelectedItems[0].Tag;}
    void SetBusy(bool value){busy=value;add.Enabled=open.Enabled=stop.Enabled=refresh.Enabled=!value;}
    async Task OpenFolder(string folder){
        if(busy)return;SetBusy(true);status.Text="서버 시작 / 기존 서버 연결 중…";
        try{var result=await Task.Run(()=>SendOpen(root,folder));url=Convert.ToString(result["url"]);token=Convert.ToString((await Task.Run(()=>Request("/api/bootstrap")))["token"]);}
        catch(Exception e){status.Text=e.Message;}
        finally{SetBusy(false);}
        await Poll();
    }
    async Task OpenSelected(){var item=Selected();if(item!=null)await OpenFolder(Convert.ToString(item["path"]));}
    async Task Poll(){
        if(busy||polling||url==null)return;polling=true;
        try {
            var result=await Task.Run(()=>Request("/api/projects"));if(IsDisposed)return;
            var selected=Selected();string keep=selected==null?null:Convert.ToString(selected["id"]);
            var rows=(System.Collections.IList)result["projects"];int running=0;Dictionary<string,object> requested=null;
            int next=Convert.ToInt32(result["selection"]);string target=Convert.ToString(result["selected"]);
            projects.BeginUpdate();projects.Items.Clear();
            foreach(object row in rows){var p=(Dictionary<string,object>)row;bool live=Convert.ToBoolean(p["running"]);if(live)running++;var item=new ListViewItem(new[]{Convert.ToString(p["name"]),live?"실행 중":"종료됨",Convert.ToString(p["url"]),Convert.ToString(p["path"])});item.Tag=p;projects.Items.Add(item);string id=Convert.ToString(p["id"]);if(id==(next!=selection?target:keep))item.Selected=true;if(id==target&&live)requested=p;}
            projects.EndUpdate();status.Text=running+"개 실행 중 · 전체 "+rows.Count+"개  |  이 창을 닫아도 서버·터미널은 유지됩니다.";
            if(next!=selection){selection=next;if(requested!=null){var address=new Uri(Convert.ToString(requested["url"]));if(address.Scheme!="http"||address.Host!="127.0.0.1")throw new Exception("Invalid server URL");if(Environment.GetEnvironmentVariable("ISP_MANAGER_NO_BROWSER")!="1")Process.Start(new ProcessStartInfo(address.AbsoluteUri){UseShellExecute=true});if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();}}
        }catch(Exception e){if(!IsDisposed)status.Text=e.Message;}finally{polling=false;}
    }
    async Task StopSelected(){
        var item=Selected();if(item==null||busy||!Convert.ToBoolean(item["running"]))return;
        if(MessageBox.Show(this,Convert.ToString(item["path"])+"\n\n이 서버의 에이전트와 터미널도 종료됩니다. 종료할까요?","서버 종료",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes)return;
        SetBusy(true);try{await Task.Run(()=>Request("/api/projects/"+item["id"]+"/stop",new {instance=item["instance"]}));status.Text="종료 요청을 보냈습니다.";}catch(Exception e){status.Text=e.Message;}finally{SetBusy(false);}
    }
}
