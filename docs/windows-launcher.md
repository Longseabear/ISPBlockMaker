# Windows offline installation

## Safe opening and server-only commands (v0.1.29+)

`isp-block-maker` with no arguments opens only the Windows server manager and central server. It does not select, initialize or open the current folder. The Start menu shortcut behaves the same way. `isp-block-maker .` explicitly opens the current workspace in the manager and browser.

Normal opening refuses a layout that would move existing entries into `project/`. It prints an explicit initialization command instead. Empty folders can be initialized normally; already initialized workspaces keep their layout. Linked repositories and unsupported layouts still require manual handling.

```powershell
isp-block-maker init . --dry-run
isp-block-maker init . --migrate-layout
isp-block-maker .
```

The first command only previews the move/copy plan. The second explicitly authorizes it and initializes workspace guidance/state without opening a server. Existing files and Git may move under `project/`; this is not an in-place source-root mode. Do not run migration unless that layout change is intended.

For an initialized workspace, `isp-block-maker serve .` starts only its server in the current terminal, without a manager window or browser. Ctrl+C stops it. It still maintains normal workspace runtime records and managed guidance.

`isp-block-maker serve --hub` starts only the central server. It does not open or initialize the current folder. If the central server already exists, it prints its address and exits. Otherwise Ctrl+C stops the newly started central server; workspace servers remain independent.

## Advanced options: central Agent API

The native manager has **서버 / 고급 옵션** tabs. Advanced options manages one bridge token and an explicit allowlist of registered workspace IDs. The bridge uses the central URL, never per-workspace ports or credentials. Access is disabled by default and localhost-only. Offline workers are not automatically started.

Closing the manager leaves the Hub and workspace servers running, regardless of whether Agent API is enabled. Disabling API access does not cancel accepted jobs. Reopen the manager with `isp-block-maker .`. Existing manager and worker processes must restart to load updated code. See [Agent API usage](personal-agent-api.md).

## Closing and stopping (v0.1.28+)

- **X / window close** closes only the manager. Terminals, agents and the central server continue. Reopening the manager reconnects and refreshes its credentials if the Hub instance changed.
- **선택 서버 종료** stops one workspace server and its terminals/agents.
- **전체 서버 종료** confirms the currently running registered workspace servers, stops them, verifies their ports have closed, and then stops the central server and closes the manager. Projects, session records and API configuration remain on disk. Unregistered servers started separately are outside this manager's scope.
- A changed server list requires confirmation again. If any stop fails, the manager and Hub remain available and report the failed servers; already stopped servers stay stopped. New starts and central API mutations are rejected during shutdown.

## Installation

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
