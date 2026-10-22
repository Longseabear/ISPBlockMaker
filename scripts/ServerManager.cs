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
    readonly Button stopAll=new Button {Text="전체 서버 종료",AutoSize=true,ForeColor=Color.Firebrick};
    readonly TabControl tabs=new TabControl {Dock=DockStyle.Fill};
    readonly CheckedListBox agentScope=new CheckedListBox {Dock=DockStyle.Fill,CheckOnClick=true,Height=140};
    readonly TextBox agentUrl=new TextBox {Dock=DockStyle.Fill,ReadOnly=true};
    readonly TextBox agentToken=new TextBox {Dock=DockStyle.Fill,ReadOnly=true,UseSystemPasswordChar=true};
    readonly Label agentStatus=new Label {AutoSize=true,MaximumSize=new Size(900,0),Text="고급 옵션을 열면 중앙 API 상태를 확인합니다."};
    readonly FlowLayoutPanel agentActions=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill};
    class WorkspaceChoice {public string Id,Name;public override string ToString(){return Name+"  ·  "+Id;}}
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer {Interval=3000};
    string url,token,hubInstance;int selection=-1;bool busy, polling;
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
        Text="ISP Block Maker · 서버 관리";Size=new Size(1050,680);MinimumSize=new Size(780,460);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);
        var heading=new Label {Text="ISP Block Maker  /  실행 중 · 최근 프로젝트",Dock=DockStyle.Top,Height=60,Padding=new Padding(16),Font=new Font("Segoe UI",14,FontStyle.Bold)};
        var actions=new FlowLayoutPanel {Dock=DockStyle.Bottom,Height=58,Padding=new Padding(12)};
        actions.Controls.AddRange(new Control[]{add,open,stop,refresh,stopAll});
        projects.Columns.Add("프로젝트",165);projects.Columns.Add("상태",90);projects.Columns.Add("서버 주소",205);projects.Columns.Add("폴더",550);
        var serversPage=new TabPage("서버");serversPage.Controls.Add(projects);serversPage.Controls.Add(actions);tabs.TabPages.Add(serversPage);
        var advancedPage=new TabPage("고급 옵션");
        var advanced=new TableLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,ColumnCount=1,Padding=new Padding(16)};
        advanced.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        advanced.Controls.Add(new Label {Text="Agent API · 메신저 / 외부 프로그램 연결",AutoSize=true,Font=new Font("Segoe UI",12,FontStyle.Bold)});
        advanced.Controls.Add(new Label {Text="메신저 → 브릿지 앱 → 중앙 서버 → 워크스페이스별 세션\n이 PC의 브릿지에서 주소와 토큰 하나로 접근합니다. 허용할 워크스페이스를 선택하세요.",AutoSize=true});
        advanced.Controls.Add(agentStatus);advanced.Controls.Add(agentUrl);
        advanced.Controls.Add(agentScope);advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.Absolute,140));
        var enableApi=new Button {Text="API 켜기 / 토큰 발급",AutoSize=true};var rotateApi=new Button {Text="토큰 재발급",AutoSize=true};var disableApi=new Button {Text="API 끄기",AutoSize=true};var saveScope=new Button {Text="접근 범위 저장",AutoSize=true};var refreshApi=new Button {Text="상태 새로고침",AutoSize=true};
        agentActions.Controls.AddRange(new Control[]{enableApi,rotateApi,disableApi,saveScope,refreshApi});advanced.Controls.Add(agentActions);
        advanced.Controls.Add(new Label {Text="발급된 토큰 (한 번만 표시 · 실행 권한이 있으므로 비밀 설정에 보관)",AutoSize=true});advanced.Controls.Add(agentToken);
        var copyRow=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill};var copyToken=new Button {Text="토큰 복사",AutoSize=true};var copyUrl=new Button {Text="API 주소 복사",AutoSize=true};var docs=new Button {Text="사용법",AutoSize=true};copyRow.Controls.AddRange(new Control[]{copyToken,copyUrl,docs});advanced.Controls.Add(copyRow);
        advanced.Controls.Add(new Label {Text="기본 꺼짐 · localhost 전용 · 워크스페이스 서버는 자동 시작하지 않습니다.\n창 닫기는 서버와 작업을 유지합니다. 완전히 종료하려면 서버 탭의 ‘전체 서버 종료’를 사용하세요.",AutoSize=true});
        advancedPage.Controls.Add(advanced);tabs.TabPages.Add(advancedPage);Controls.Add(tabs);Controls.Add(status);Controls.Add(heading);
        tabs.SelectedIndexChanged+=async(s,e)=>{if(tabs.SelectedIndex==1)await LoadAgentSettings();};
        enableApi.Click+=async(s,e)=>await ChangeAgentSettings("enable");rotateApi.Click+=async(s,e)=>await ChangeAgentSettings("rotate");disableApi.Click+=async(s,e)=>await ChangeAgentSettings("disable");saveScope.Click+=async(s,e)=>await ChangeAgentSettings("scope");refreshApi.Click+=async(s,e)=>await LoadAgentSettings();
        copyToken.Click+=(s,e)=>{try{if(agentToken.Text.Length>0)Clipboard.SetText(agentToken.Text);}catch(Exception ex){agentStatus.Text=ex.Message;}};
        copyUrl.Click+=(s,e)=>{try{if(agentUrl.Text.Length>0)Clipboard.SetText(agentUrl.Text);}catch(Exception ex){agentStatus.Text=ex.Message;}};
        docs.Click+=(s,e)=>{try{Process.Start(new ProcessStartInfo(Path.Combine(root,"docs","personal-agent-api.md")){UseShellExecute=true});}catch(Exception ex){agentStatus.Text=ex.Message;}};
        status.Text="서버 목록을 확인하고 있습니다…";
        open.Click+=async(s,e)=>await OpenSelected();projects.DoubleClick+=async(s,e)=>await OpenSelected();
        add.Click+=async(s,e)=>{using(var picker=new FolderBrowserDialog {Description="ISP 작업 폴더",ShowNewFolderButton=true})if(picker.ShowDialog(this)==DialogResult.OK)await OpenFolder(picker.SelectedPath);};
        stop.Click+=async(s,e)=>await StopSelected();refresh.Click+=async(s,e)=>await Poll();timer.Tick+=async(s,e)=>await Poll();
        stopAll.Click+=async(s,e)=>await StopAll();
        Shown+=async(s,e)=>{await OpenFolder(initialFolder);timer.Start();};
        FormClosing+=(s,e)=>{if(busy){e.Cancel=true;status.Text="시작/종료 작업이 끝난 후 닫아주세요.";return;}timer.Stop();};
        FormClosed+=(s,e)=>{agentToken.Clear();};
    }
    Dictionary<string,object> Selected(){return projects.SelectedItems.Count==0?null:(Dictionary<string,object>)projects.SelectedItems[0].Tag;}
    void SetBusy(bool value){busy=value;add.Enabled=open.Enabled=stop.Enabled=stopAll.Enabled=refresh.Enabled=agentActions.Enabled=!value;}
    async Task LoadAgentSettings(){
        if(busy||url==null)return;SetBusy(true);
        try{var data=await Task.Run(()=>Request("/api/agent-settings"));agentUrl.Text=Convert.ToString(data["base_url"]);agentStatus.Text=Convert.ToBoolean(data["enabled"])?"중앙 Agent API 켜짐 · 허용된 워크스페이스에만 접근":"중앙 Agent API 꺼짐";agentToken.Clear();
            var allowed=new HashSet<string>();foreach(object id in (System.Collections.IList)data["workspace_ids"])allowed.Add(Convert.ToString(id));agentScope.Items.Clear();
            foreach(object row in (System.Collections.IList)data["workspaces"]){var p=(Dictionary<string,object>)row;var choice=new WorkspaceChoice {Id=Convert.ToString(p["id"]),Name=Convert.ToString(p["name"])+(Convert.ToBoolean(p["running"])?" (실행 중)":" (종료됨)")};agentScope.Items.Add(choice,allowed.Contains(choice.Id));}
        }catch(Exception e){agentStatus.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task ChangeAgentSettings(string action){
        if(busy||url==null)return;SetBusy(true);
        try{var ids=new List<string>();foreach(WorkspaceChoice item in agentScope.CheckedItems)ids.Add(item.Id);var data=await Task.Run(()=>Request("/api/agent-settings",new {action=action,workspace_ids=ids.ToArray()}));agentUrl.Text=Convert.ToString(data["base_url"]);agentToken.Text=data.ContainsKey("token")?Convert.ToString(data["token"]):"";agentStatus.Text=Convert.ToBoolean(data["enabled"])?"중앙 Agent API 켜짐 · 설정 적용 완료":"중앙 Agent API 꺼짐";
        }catch(Exception e){agentStatus.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task OpenFolder(string folder){
        if(busy)return;SetBusy(true);status.Text="서버 시작 / 기존 서버 연결 중…";
        try{var result=await Task.Run(()=>SendOpen(root,folder));url=Convert.ToString(result["url"]);token=Convert.ToString((await Task.Run(()=>Request("/api/bootstrap")))["token"]);}
        catch(Exception e){status.Text=e.Message;}
        finally{SetBusy(false);}
        await Poll();
    }
    async Task OpenSelected(){var item=Selected();if(item!=null)await OpenFolder(Convert.ToString(item["path"]));}
    bool RefreshHubConnection(){
        string stateHome=Environment.GetEnvironmentVariable("ISP_STATE_HOME") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ISPBlockMaker","state");
        var record=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(stateHome,"hub.json")));
        string nextUrl=Convert.ToString(record["url"]),nextInstance=Convert.ToString(record["instance"]);
        var address=new Uri(nextUrl);if(address.Scheme!="http"||address.Host!="127.0.0.1"||address.UserInfo.Length>0)throw new Exception("Invalid hub URL");
        if(url==nextUrl&&hubInstance==nextInstance)return false;
        url=address.GetLeftPart(UriPartial.Authority);
        var health=Request("/health");
        if(Convert.ToString(health["app"])!="ISPBlockMakerHub"||Convert.ToString(health["instance"])!=nextInstance)throw new Exception("중앙 서버가 변경 중입니다. 다시 연결합니다.");
        token=Convert.ToString(Request("/api/bootstrap")["token"]);hubInstance=nextInstance;return true;
    }
    async Task Poll(){
        if(busy||polling||url==null)return;polling=true;
        try {
            if(await Task.Run(()=>RefreshHubConnection()))selection=-1;
            var result=await Task.Run(()=>Request("/api/projects"));if(IsDisposed||busy)return;
            var selected=Selected();string keep=selected==null?null:Convert.ToString(selected["id"]);
            var rows=(System.Collections.IList)result["projects"];int running=0;Dictionary<string,object> requested=null;
            int next=Convert.ToInt32(result["selection"]);string target=Convert.ToString(result["selected"]);
            projects.BeginUpdate();projects.Items.Clear();
            foreach(object row in rows){var p=(Dictionary<string,object>)row;bool live=Convert.ToBoolean(p["running"]);if(live)running++;var item=new ListViewItem(new[]{Convert.ToString(p["name"]),live?"실행 중":"종료됨",Convert.ToString(p["url"]),Convert.ToString(p["path"])});item.Tag=p;projects.Items.Add(item);string id=Convert.ToString(p["id"]);if(id==(next!=selection?target:keep))item.Selected=true;if(id==target&&live)requested=p;}
            projects.EndUpdate();status.Text=running+"개 실행 중 · 전체 "+rows.Count+"개  |  X: 관리 창만 닫기 · 서버/작업 유지\n완전히 종료하려면 ‘전체 서버 종료’ · 다시 열기: isp-block-maker .";
            if(next!=selection&&requested!=null){var address=new Uri(Convert.ToString(requested["url"]));if(address.Scheme!="http"||address.Host!="127.0.0.1")throw new Exception("Invalid server URL");if(Environment.GetEnvironmentVariable("ISP_MANAGER_NO_BROWSER")!="1")Process.Start(new ProcessStartInfo(address.AbsoluteUri){UseShellExecute=true});selection=next;if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();}
        }catch(Exception e){if(!IsDisposed)status.Text=e.Message;}finally{polling=false;}
    }
    async Task StopSelected(){
        var item=Selected();if(item==null||busy||!Convert.ToBoolean(item["running"]))return;
        if(MessageBox.Show(this,Convert.ToString(item["path"])+"\n\n이 서버의 에이전트와 터미널도 종료됩니다. 종료할까요?","서버 종료",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes)return;
        SetBusy(true);try{await Task.Run(()=>Request("/api/projects/"+item["id"]+"/stop",new {instance=item["instance"]}));status.Text="종료 요청을 보냈습니다.";}catch(Exception e){status.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task StopAll(){
        if(busy||url==null)return;SetBusy(true);bool stopped=false;
        try{
            await Task.Run(()=>RefreshHubConnection());
            var health=await Task.Run(()=>Request("/health"));var listing=await Task.Run(()=>Request("/api/projects"));
            var targets=new List<object>();var names=new List<string>();
            foreach(object row in (System.Collections.IList)listing["projects"]){var p=(Dictionary<string,object>)row;if(Convert.ToBoolean(p["running"])){targets.Add(new {id=p["id"],instance=p["instance"]});names.Add(Convert.ToString(p["name"]));}}
            if(MessageBox.Show(this,"관리 중인 워크스페이스 서버 "+targets.Count+"개와 중앙 서버를 완전히 종료합니다.\n"+String.Join(", ",names.ToArray())+"\n\n실행 중인 에이전트·터미널도 종료됩니다. 작업을 저장했나요?\n메신저 API도 중단됩니다. 프로젝트 파일과 설정은 유지됩니다.","전체 서버 종료",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2)!=DialogResult.Yes)return;
            status.Text="서버와 작업을 종료하고 있습니다…";
            await Task.Run(()=>Request("/api/shutdown-all",new {instance=health["instance"],servers=targets.ToArray()}));stopped=true;
        }catch(Exception e){status.Text=e.Message;MessageBox.Show(this,e.Message,"전체 종료 미완료",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
        finally{SetBusy(false);}
        if(stopped){timer.Stop();Close();}
    }
}
