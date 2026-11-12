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
    readonly Label status=new Label {Dock=DockStyle.Bottom,Height=64,Padding=new Padding(16,10,16,8),BackColor=Color.FromArgb(243,245,248),ForeColor=Color.FromArgb(80,90,105)};
    readonly Button open=new Button {Text="Open Workspace",AutoSize=true};
    readonly Button stop=new Button {Text="Stop Server",AutoSize=true};
    readonly Button add=new Button {Text="Open Folder…",AutoSize=true};
    readonly Button remove=new Button {Text="",AutoSize=false,Size=new Size(42,42),AccessibleName="Remove from List"};
    readonly ContextMenuStrip projectMenu=new ContextMenuStrip();
    readonly ToolTip hints=new ToolTip();
    readonly Button refresh=new Button {Text="Refresh",AutoSize=true};
    readonly Button stopAll=new Button {Text="Shut Down All…",AutoSize=true,ForeColor=Color.Firebrick};
    readonly Label hubStatus=new Label {Text="연결 확인 중",AutoSize=true,Font=new Font("Segoe UI",16,FontStyle.Bold)};
    readonly TextBox hubAddress=new TextBox {ReadOnly=true,Dock=DockStyle.Fill};
    readonly Button hubConnect=new Button {Text="Start / Reconnect",AutoSize=true};
    readonly TabControl tabs=new TabControl {Dock=DockStyle.Fill};
    readonly CheckBox manageWorkspaces=new CheckBox {Text="모든 워크스페이스 조회·등록·시작 및 작업 허용",AutoSize=true};
    readonly CheckedListBox agentScope=new CheckedListBox {Dock=DockStyle.Fill,CheckOnClick=true,Height=140};
    readonly TextBox agentUrl=new TextBox {Dock=DockStyle.Fill,ReadOnly=true};
    readonly TextBox agentToken=new TextBox {Dock=DockStyle.Fill,ReadOnly=true,UseSystemPasswordChar=true};
    readonly Label agentStatus=new Label {AutoSize=true,MaximumSize=new Size(900,0),Text="에이전트 프로그램 연결 상태를 확인합니다."};
    readonly FlowLayoutPanel agentActions=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill};
    class WorkspaceChoice {public string Id,Name;public override string ToString(){return Name;}}
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer {Interval=3000};
    string url,token,hubInstance;int selection=-1;bool busy, polling, confirming;string projectSnapshot;
    static JavaScriptSerializer Json {get{return new JavaScriptSerializer();}}

    public static Dictionary<string,object> SendOpen(string root,string folder) {
        string node=Path.Combine(root,"node.exe");if(!File.Exists(node))node="node.exe";
        var info=new ProcessStartInfo(node,"\""+Path.Combine(root,"server","hub.mjs")+"\" --open") {WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
        info.EnvironmentVariables["ISP_MANAGER_FOLDER"]=folder??"";
        info.EnvironmentVariables["ISP_MANAGER_ONLY"]=folder==null?"1":"0";
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
        Text="ISP Block Maker · Workspaces";Size=new Size(1050,680);MinimumSize=new Size(860,600);StartPosition=FormStartPosition.CenterScreen;Font=new Font("맑은 고딕",10);AutoScaleMode=AutoScaleMode.Dpi;BackColor=Color.White;
        var heading=new Label {Text="ISP Block Maker",Dock=DockStyle.Top,Height=56,Padding=new Padding(20,14,20,10),Font=new Font("Segoe UI",13,FontStyle.Bold),BackColor=Color.White,ForeColor=Color.FromArgb(35,42,52)};
        tabs.DrawMode=TabDrawMode.OwnerDrawFixed;tabs.SizeMode=TabSizeMode.Fixed;tabs.ItemSize=new Size(170,38);
        tabs.DrawItem+=(s,e)=>{bool active=e.Index==tabs.SelectedIndex;using(var bg=new SolidBrush(active?Color.White:Color.FromArgb(239,242,247)))e.Graphics.FillRectangle(bg,e.Bounds);TextRenderer.DrawText(e.Graphics,tabs.TabPages[e.Index].Text,Font,e.Bounds,active?Color.FromArgb(35,79,160):Color.FromArgb(90,100,115),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);if(active)using(var pen=new Pen(Color.FromArgb(49,97,193),3))e.Graphics.DrawLine(pen,e.Bounds.Left+12,e.Bounds.Bottom-2,e.Bounds.Right-12,e.Bounds.Bottom-2);};
        var homePage=new TabPage("Server Settings") {BackColor=Color.White};
        var home=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,AutoScroll=true,Padding=new Padding(24,16,24,12)};
        home.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        home.Controls.Add(new Label {Text="Server Settings",AutoSize=true,Font=new Font("Segoe UI",14,FontStyle.Bold),Margin=new Padding(0,0,0,12)});
        home.Controls.Add(new Label {Text="이 관리 창을 열면 중앙 서버가 시작됩니다. 워크스페이스를 열 필요는 없습니다.",AutoSize=true,Margin=new Padding(0,0,0,12)});
        home.Controls.Add(hubStatus);
        home.Controls.Add(new Label {Text="중앙 서버 주소",AutoSize=true,Margin=new Padding(0,20,0,6)});
        home.Controls.Add(hubAddress);
        var hubActions=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,12,0,12)};
        var configure=new Button {Text="Configure Agent Access →",AutoSize=true};
        hubActions.Controls.AddRange(new Control[]{hubConnect,configure});home.Controls.Add(hubActions);
        home.Controls.Add(new Label {Text="시작하는 방법",AutoSize=true,Font=new Font("Segoe UI",12,FontStyle.Bold),Margin=new Padding(0,6,0,8)});
        home.Controls.Add(new Label {Text="관리 창 + 중앙 서버     isp-block-maker\n중앙 서버만 실행        isp-block-maker serve --hub",AutoSize=true,Font=new Font("Consolas",11),Margin=new Padding(0,0,0,12)});
        home.Controls.Add(new Label {Text="중앙 서버 실행과 프로그램 연결 허용은 별도입니다.\n프로그램을 연결하려면 Agent Access 탭에서 허용 워크스페이스와 토큰을 설정하세요.\n워크스페이스에서 작업하려면 Workspaces 탭에서 해당 서버를 시작하세요.",AutoSize=true,Margin=new Padding(0,0,0,12)});
        var homeStop=new Button {Text="Shut Down All…",AutoSize=true,ForeColor=Color.Firebrick};homeStop.Click+=async(s,e)=>await StopAll();hubActions.Controls.Add(homeStop);
        homePage.Controls.Add(home);
        hubConnect.Click+=async(s,e)=>await OpenFolder(null);
        configure.Click+=(s,e)=>tabs.SelectedIndex=2;
        var actions=new FlowLayoutPanel {Dock=DockStyle.Top,Height=64,Padding=new Padding(12),WrapContents=false};
        actions.Controls.AddRange(new Control[]{add,open,stop,refresh,remove});
        var shutdown=new TableLayoutPanel {Dock=DockStyle.Bottom,Height=76,ColumnCount=2,Padding=new Padding(14,12,14,8),BackColor=Color.FromArgb(248,249,251)};
        shutdown.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));shutdown.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        shutdown.Controls.Add(new Label {Text="모든 서버와 작업 종료\n관리 목록의 서버·에이전트·터미널과 중앙 API를 종료합니다.",AutoSize=true,Dock=DockStyle.Fill,ForeColor=Color.FromArgb(80,90,105)},0,0);
        stopAll.Anchor=AnchorStyles.Right;shutdown.Controls.Add(stopAll,1,0);
        projects.BorderStyle=BorderStyle.None;projects.HeaderStyle=ColumnHeaderStyle.Nonclickable;projects.ShowItemToolTips=true;
        projects.Columns.Add("Workspace",180);projects.Columns.Add("Status",90);projects.Columns.Add("Address",190);projects.Columns.Add("Folder",500);
        var serversPage=new TabPage("Workspaces") {Padding=new Padding(8),BackColor=Color.White};serversPage.Controls.Add(projects);serversPage.Controls.Add(actions);serversPage.Controls.Add(shutdown);tabs.TabPages.Add(serversPage);tabs.TabPages.Add(homePage);
        projects.SelectedIndexChanged+=(s,e)=>UpdateActions();
        projects.Resize+=(s,e)=>{if(projects.Columns.Count==4)projects.Columns[3].Width=Math.Max(180,projects.ClientSize.Width-480);};
        var advancedPage=new TabPage("Agent Access") {BackColor=Color.White};
        var advanced=new TableLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,ColumnCount=1,Padding=new Padding(16)};
        advanced.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        advanced.Controls.Add(new Label {Text="Agent Access",AutoSize=true,Font=new Font("Segoe UI",12,FontStyle.Bold)});
        advanced.Controls.Add(new Label {Text="에이전트 프로그램 → 중앙 서버 → 워크스페이스별 세션\n이 PC의 에이전트 프로그램에서 주소와 토큰 하나로 접근합니다. 허용할 워크스페이스를 선택하세요.",AutoSize=true});
        advanced.Controls.Add(agentStatus);advanced.Controls.Add(agentUrl);
        advanced.Controls.Add(agentScope);advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.AutoSize));advanced.RowStyles.Add(new RowStyle(SizeType.Absolute,140));
        var enableApi=new Button {Text="Enable Access",AutoSize=true};var rotateApi=new Button {Text="Rotate Token",AutoSize=true};var disableApi=new Button {Text="Disable Access",AutoSize=true};var saveScope=new Button {Text="Save Permissions",AutoSize=true};var refreshApi=new Button {Text="Refresh Status",AutoSize=true};
        agentActions.Controls.AddRange(new Control[]{enableApi,rotateApi,disableApi,saveScope,refreshApi});advanced.Controls.Add(agentActions);advanced.Controls.Add(manageWorkspaces);
        advanced.Controls.Add(new Label {Text="발급된 토큰 (한 번만 표시 · 실행 권한이 있으므로 비밀 설정에 보관)",AutoSize=true});advanced.Controls.Add(agentToken);
        var copyRow=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill};var copyToken=new Button {Text="Copy Token",AutoSize=true};var copyUrl=new Button {Text="Copy API URL",AutoSize=true};var docs=new Button {Text="Guide",AutoSize=true};copyRow.Controls.AddRange(new Control[]{copyToken,copyUrl,docs});advanced.Controls.Add(copyRow);
        advanced.Controls.Add(new Label {Text="기본 꺼짐 · localhost 전용 · 워크스페이스 서버는 자동 시작하지 않습니다.\n창 닫기는 서버와 작업을 유지합니다. 완전히 종료하려면 Workspaces 탭의 ‘Shut Down All’를 사용하세요.",AutoSize=true});
        advancedPage.Controls.Add(advanced);tabs.TabPages.Add(advancedPage);tabs.SelectedIndex=0;Controls.Add(tabs);Controls.Add(status);Controls.Add(heading);
        tabs.SelectedIndexChanged+=async(s,e)=>{if(tabs.SelectedTab==advancedPage)await LoadAgentSettings();};
        enableApi.Click+=async(s,e)=>await ChangeAgentSettings("enable");rotateApi.Click+=async(s,e)=>await ChangeAgentSettings("rotate");disableApi.Click+=async(s,e)=>await ChangeAgentSettings("disable");saveScope.Click+=async(s,e)=>await ChangeAgentSettings("scope");refreshApi.Click+=async(s,e)=>await LoadAgentSettings();
        copyToken.Click+=(s,e)=>{try{if(agentToken.Text.Length>0)Clipboard.SetText(agentToken.Text);}catch(Exception ex){agentStatus.Text=ex.Message;}};
        copyUrl.Click+=(s,e)=>{try{if(agentUrl.Text.Length>0)Clipboard.SetText(agentUrl.Text);}catch(Exception ex){agentStatus.Text=ex.Message;}};
        docs.Click+=(s,e)=>{try{Process.Start(new ProcessStartInfo(Path.Combine(root,"docs","personal-agent-api.md")){UseShellExecute=true});}catch(Exception ex){agentStatus.Text=ex.Message;}};
        StyleControls(this);hints.SetToolTip(remove,"Remove from List (files are kept)");
        remove.Paint+=(s,e)=>{using(var pen=new Pen(remove.Enabled?Color.FromArgb(105,115,128):Color.LightGray,1.6f)){int x=remove.ClientSize.Width/2,y=remove.ClientSize.Height/2;e.Graphics.DrawLine(pen,x-8,y-6,x+8,y-6);e.Graphics.DrawRectangle(pen,x-3,y-10,6,3);e.Graphics.DrawRectangle(pen,x-6,y-5,12,14);e.Graphics.DrawLine(pen,x-2,y-2,x-2,y+5);e.Graphics.DrawLine(pen,x+2,y-2,x+2,y+5);}};
        remove.Click+=async(s,e)=>await RemoveSelected();UpdateActions();
        status.Text="서버 목록을 확인하고 있습니다…";
        open.Click+=async(s,e)=>await OpenSelected();projects.DoubleClick+=async(s,e)=>await OpenSelected();
        add.Click+=async(s,e)=>{using(var picker=new FolderBrowserDialog {Description="ISP 작업 폴더",ShowNewFolderButton=true})if(picker.ShowDialog(this)==DialogResult.OK)await OpenFolder(picker.SelectedPath);};
        stop.Click+=async(s,e)=>await StopSelected();refresh.Click+=async(s,e)=>await Poll();timer.Tick+=async(s,e)=>await Poll();
        var menuOpen=new ToolStripMenuItem("Open Workspace");var menuStop=new ToolStripMenuItem("Stop Server");var menuCopy=new ToolStripMenuItem("Copy Folder Path");var menuRemove=new ToolStripMenuItem("Remove from List…");
        projectMenu.Items.AddRange(new ToolStripItem[]{menuOpen,menuStop,menuCopy,new ToolStripSeparator(),menuRemove});projects.ContextMenuStrip=projectMenu;
        projectMenu.Opening+=(s,e)=>{var item=Selected();if(item==null||busy){e.Cancel=true;return;}menuOpen.Text=Convert.ToBoolean(item["running"])?"Open Workspace":"Start Server";menuStop.Enabled=Convert.ToBoolean(item["running"]);};
        projects.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Right){var hit=projects.GetItemAt(e.X,e.Y);projects.SelectedItems.Clear();if(hit!=null){hit.Selected=true;hit.Focused=true;}}};
        menuOpen.Click+=async(s,e)=>await OpenSelected();menuStop.Click+=async(s,e)=>await StopSelected();menuRemove.Click+=async(s,e)=>await RemoveSelected();
        menuCopy.Click+=(s,e)=>{var item=Selected();if(item!=null)try{Clipboard.SetText(Convert.ToString(item["path"]));}catch(Exception ex){status.Text=ex.Message;}};
        projects.KeyDown+=async(s,e)=>{if(e.KeyCode==Keys.Delete){e.SuppressKeyPress=true;await RemoveSelected();}else if(e.KeyCode==Keys.Enter){e.SuppressKeyPress=true;await OpenSelected();}else if(e.KeyCode==Keys.F5){e.SuppressKeyPress=true;await Poll();}};
        stopAll.Click+=async(s,e)=>await StopAll();
        Shown+=async(s,e)=>{await OpenFolder(initialFolder);timer.Start();};
        FormClosing+=(s,e)=>{if(busy){e.Cancel=true;status.Text="시작/종료 작업이 끝난 후 닫아주세요.";return;}timer.Stop();};
        FormClosed+=(s,e)=>{agentToken.Clear();timer.Dispose();hints.Dispose();projectMenu.Dispose();};
    }
    Dictionary<string,object> Selected(){return projects.SelectedItems.Count==0?null:(Dictionary<string,object>)projects.SelectedItems[0].Tag;}
    static void StyleControls(Control parent){
        foreach(Control control in parent.Controls){
            var button=control as Button;
            if(button!=null){button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderColor=Color.FromArgb(211,217,225);button.BackColor=Color.White;button.Padding=new Padding(10,5,10,5);button.Margin=new Padding(0,0,8,0);button.Cursor=Cursors.Hand;}
            StyleControls(control);
        }
    }
    void UpdateActions(){
        var selected=Selected();bool live=selected!=null&&Convert.ToBoolean(selected["running"]);
        remove.Enabled=!busy&&selected!=null;open.Enabled=!busy&&selected!=null;open.Text=live?"Open Workspace":"Start Server";stop.Enabled=!busy&&live;
    }
    void SetBusy(bool value){busy=value;hubConnect.Enabled=add.Enabled=stopAll.Enabled=refresh.Enabled=agentActions.Enabled=manageWorkspaces.Enabled=agentScope.Enabled=!value;UpdateActions();}
    async Task LoadAgentSettings(){
        if(busy||url==null)return;SetBusy(true);
        try{var data=await Task.Run(()=>Request("/api/agent-settings"));agentUrl.Text=Convert.ToString(data["base_url"]);agentStatus.Text=Convert.ToBoolean(data["enabled"])?"중앙 Agent API 켜짐 · 허용된 워크스페이스에만 접근":"중앙 Agent API 꺼짐";agentToken.Clear();manageWorkspaces.Checked=data.ContainsKey("manage_workspaces")&&Convert.ToBoolean(data["manage_workspaces"]);
            var allowed=new HashSet<string>();foreach(object id in (System.Collections.IList)data["workspace_ids"])allowed.Add(Convert.ToString(id));agentScope.Items.Clear();
            foreach(object row in (System.Collections.IList)data["workspaces"]){var p=(Dictionary<string,object>)row;var choice=new WorkspaceChoice {Id=Convert.ToString(p["id"]),Name=Convert.ToString(p["name"])+(Convert.ToBoolean(p["running"])?" (실행 중)":" (종료됨)")};agentScope.Items.Add(choice,allowed.Contains(choice.Id));}
        }catch(Exception e){agentStatus.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task ChangeAgentSettings(string action){
        if(busy||url==null)return;SetBusy(true);
        try{bool manage=manageWorkspaces.Checked;var ids=new List<string>();foreach(WorkspaceChoice item in agentScope.CheckedItems)ids.Add(item.Id);var data=await Task.Run(()=>Request("/api/agent-settings",new {action=action,workspace_ids=ids.ToArray(),manage_workspaces=manage}));agentUrl.Text=Convert.ToString(data["base_url"]);agentToken.Text=data.ContainsKey("token")?Convert.ToString(data["token"]):"";agentStatus.Text=Convert.ToBoolean(data["enabled"])?"중앙 Agent API 켜짐 · 설정 적용 완료":"중앙 Agent API 꺼짐";
        }catch(Exception e){agentStatus.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task OpenFolder(string folder){
        if(busy||confirming)return;SetBusy(true);hubStatus.Text="중앙 서버에 연결 중…";status.Text="서버 시작 / 기존 서버 연결 중…";
        try{var result=await Task.Run(()=>SendOpen(root,folder));url=Convert.ToString(result["url"]);token=Convert.ToString((await Task.Run(()=>Request("/api/bootstrap")))["token"]);}
        catch(Exception e){hubStatus.Text="중앙 서버 연결 실패";hubAddress.Clear();status.Text=e.Message;}
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
        if(busy||polling||confirming||projectMenu.Visible||url==null)return;polling=true;
        try {
            if(await Task.Run(()=>RefreshHubConnection()))selection=-1;
            var result=await Task.Run(()=>Request("/api/projects"));if(IsDisposed||busy||confirming||projectMenu.Visible)return;hubStatus.Text="● 실행 중";hubStatus.ForeColor=Color.FromArgb(28,108,78);hubAddress.Text=url;
            var selected=Selected();string keep=selected==null?null:Convert.ToString(selected["id"]);
            var rows=(System.Collections.IList)result["projects"];int running=0;Dictionary<string,object> requested=null;
            int next=Convert.ToInt32(result["selection"]);string target=Convert.ToString(result["selected"]);
            string snapshot=Json.Serialize(rows);
            if(snapshot!=projectSnapshot||next!=selection){
            string top=projects.TopItem==null?null:Convert.ToString(((Dictionary<string,object>)projects.TopItem.Tag)["id"]);
            projects.BeginUpdate();try{projects.Items.Clear();
            foreach(object row in rows){var p=(Dictionary<string,object>)row;bool live=Convert.ToBoolean(p["running"]);if(live)running++;var item=new ListViewItem(new[]{Convert.ToString(p["name"]),live?"실행 중":"종료됨",Convert.ToString(p["url"]),Convert.ToString(p["path"])});item.Tag=p;item.ToolTipText=Convert.ToString(p["path"]);item.ForeColor=live?Color.FromArgb(28,108,78):Color.FromArgb(105,115,128);projects.Items.Add(item);string id=Convert.ToString(p["id"]);if(id==(next!=selection?target:keep))item.Selected=true;if(id==target&&live)requested=p;}
            if(next==selection&&top!=null)foreach(ListViewItem row in projects.Items)if(Convert.ToString(((Dictionary<string,object>)row.Tag)["id"])==top){projects.TopItem=row;break;}
            projectSnapshot=snapshot;
            }finally{projects.EndUpdate();}}
            UpdateActions();status.Text=(rows.Count==0?"No workspaces yet — choose Open Folder.\n":"")+running+"개 실행 중 · 전체 "+rows.Count+"개  |  X: 관리 창만 닫기 · 서버/작업 유지\n완전히 종료하려면 ‘Shut Down All’ · 다시 열기: isp-block-maker";
            if(next!=selection&&String.IsNullOrEmpty(target)){selection=next;if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();}
            if(next!=selection&&requested!=null){var address=new Uri(Convert.ToString(requested["url"]));if(address.Scheme!="http"||address.Host!="127.0.0.1")throw new Exception("Invalid server URL");if(Environment.GetEnvironmentVariable("ISP_MANAGER_NO_BROWSER")!="1")Process.Start(new ProcessStartInfo(address.AbsoluteUri){UseShellExecute=true});selection=next;if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();}
        }catch(Exception e){if(!IsDisposed){hubStatus.Text="연결 끊김 · 다시 연결하세요";hubStatus.ForeColor=Color.Firebrick;hubAddress.Clear();status.Text=e.Message;}}finally{polling=false;}
    }
    DialogResult Confirm(string message,string title,MessageBoxIcon icon){
        confirming=true;try{return MessageBox.Show(this,message,title,MessageBoxButtons.YesNo,icon,MessageBoxDefaultButton.Button2);}finally{confirming=false;}
    }
    async Task RemoveSelected(){
        var item=Selected();if(item==null||busy||confirming)return;
        if(Convert.ToBoolean(item["running"])){MessageBox.Show(this,"Stop this workspace server first, then remove it from the list. Project files and conversations will be kept.","Remove from List",MessageBoxButtons.OK,MessageBoxIcon.Information);return;}
        if(Confirm("Remove "+Convert.ToString(item["name"])+" from the list?\n"+Convert.ToString(item["path"])+"\n\nProject files and conversations are kept. Agent access is removed. Use Open Folder to add it again.","Remove from List",MessageBoxIcon.Question)!=DialogResult.Yes)return;
        SetBusy(true);try{await Task.Run(()=>Request("/api/projects/"+item["id"]+"/remove",new {}));}
        catch(Exception e){MessageBox.Show(this,e.Message,"Remove from List",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
        finally{SetBusy(false);}await Poll();
    }
    async Task StopSelected(){
        var item=Selected();if(item==null||busy||confirming||!Convert.ToBoolean(item["running"]))return;
        if(Confirm(Convert.ToString(item["path"])+"\n\n이 서버의 에이전트와 터미널도 종료됩니다. 종료할까요?","Stop Server",MessageBoxIcon.Warning)!=DialogResult.Yes)return;
        SetBusy(true);try{await Task.Run(()=>Request("/api/projects/"+item["id"]+"/stop",new {instance=item["instance"]}));status.Text="종료 요청을 보냈습니다.";}catch(Exception e){status.Text=e.Message;}finally{SetBusy(false);}
    }
    async Task StopAll(){
        if(busy||url==null)return;SetBusy(true);bool stopped=false;
        try{
            await Task.Run(()=>RefreshHubConnection());
            var health=await Task.Run(()=>Request("/health"));var listing=await Task.Run(()=>Request("/api/projects"));
            var targets=new List<object>();var names=new List<string>();
            foreach(object row in (System.Collections.IList)listing["projects"]){var p=(Dictionary<string,object>)row;if(Convert.ToBoolean(p["running"])){targets.Add(new {id=p["id"],instance=p["instance"]});names.Add(Convert.ToString(p["name"]));}}
            if(MessageBox.Show(this,"관리 중인 워크스페이스 서버 "+targets.Count+"개와 중앙 서버를 완전히 종료합니다.\n"+String.Join(", ",names.ToArray())+"\n\n실행 중인 에이전트·터미널도 종료됩니다. 작업을 저장했나요?\n에이전트 프로그램 연결도 중단됩니다. 프로젝트 파일과 설정은 유지됩니다.","전체 서버 종료",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2)!=DialogResult.Yes)return;
            status.Text="서버와 작업을 종료하고 있습니다…";
            await Task.Run(()=>Request("/api/shutdown-all",new {instance=health["instance"],servers=targets.ToArray()}));stopped=true;
        }catch(Exception e){status.Text=e.Message;MessageBox.Show(this,e.Message,"전체 종료 미완료",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
        finally{SetBusy(false);}
        if(stopped){timer.Stop();Close();}
    }
}
