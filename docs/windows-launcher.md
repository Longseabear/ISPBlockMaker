# Windows offline installation

Build with `npm run build:installer` on Windows. Outputs: `release/ISPBlockMaker-Setup.exe`, SHA-256 sidecar and offline ZIP. The package includes the current Windows Node runtime, native terminal files, production server dependencies and built frontend. Installation needs neither npm nor network access. The build downloads and caches the matching Node license. Architecture matches the build Node (x64 here); Windows 10/11 with .NET Framework 4.x is required.

Run Setup to install per-user under `%LOCALAPPDATA%\Programs\ISPBlockMaker`. It registers `bin` in user PATH and adds a Start menu shortcut and uninstall entry. It does not install global Node or change machine PATH. Open a new terminal:

```powershell
cd D:\Workspace\adaptive-denoise
isp-block-maker .
isp-block-maker "D:\Workspace\another project"
```

The folder must exist. A new workspace gets graph.json, local skills, agent guidance and ignored .isp tools/state. Existing implementation, graph and customized skills are preserved. The Start menu shortcut opens a folder chooser.

Commands share one native Windows **server manager** window per user. Running and recent projects appear with their folder, server URL and status. Repeating a command reuses the window and existing workspace server; a different folder adds another isolated workspace server. Use **폴더 열기…**, **시작 / 웹 열기**, or **선택 서버 종료** to manage them. Closing the manager keeps workspace servers and terminals running; explicitly stopping a selected server ends its terminals and agents after confirmation. Reopening the manager discovers these running servers again.

The web workspace UI stays unchanged. Its folder-open dialog also lists running and recent projects; opening one navigates directly to that workspace URL. There is no browser hub or iframe wrapper. Development `npm start` retains its existing in-place switching behavior. The local management endpoint uses port 4309 (or `ISP_HUB_PORT`) and is not a web workspace page.

Updates install alongside older app versions under versions/. Close the old launcher before using the new version. Server configuration/discovery lives in `%LOCALAPPDATA%\ISPBlockMaker\state`; diagnostic logs live in `%LOCALAPPDATA%\ISPBlockMaker\logs`. Workspaces stay outside the installation. The bundled Node is available in the server terminal PATH.

Uninstall through Windows installed apps after closing launchers. Only package-owned files are removed. Workspaces and local logs/state are retained. For ZIP deployment, extract and run install.ps1. Use `install.ps1 -NoRegistration` to prepare the local command without changing PATH, shortcuts or registry.

Git, Python and coding agents (including their dependencies and internal endpoints) remain separate prerequisites for those features. This installer is unsigned; organizational signing can be applied before distribution.

# SDD documents

Documentation → SDD 작성 요청 queues a global request; it does not automatically run an agent. The local sdd.md guide directs Overview → Flow → block details in self-contained HTML. Register with `node .isp/tools/isp.mjs document .isp/documents/sdd.html --revision N`. Documentation shows registered versions and an HTML download. Documents remain local artifacts, separate from implementation Git history.
