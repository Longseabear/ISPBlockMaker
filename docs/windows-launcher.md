# Windows offline installation

Build with `npm run build:installer` on Windows. Outputs: `release/ISPBlockMaker-Setup.exe`, SHA-256 sidecar and offline ZIP. The package includes the current Windows Node runtime, native terminal files, production server dependencies and built frontend. Installation needs neither npm nor network access. The build downloads and caches the matching Node license. Architecture matches the build Node (x64 here); Windows 10/11 with .NET Framework 4.x is required.

Run Setup to install per-user under `%LOCALAPPDATA%\Programs\ISPBlockMaker`. It registers `bin` in user PATH and adds a Start menu shortcut and uninstall entry. It does not install global Node or change machine PATH. Open a new terminal:

```powershell
cd D:\Workspace\adaptive-denoise
isp-block-maker .
isp-block-maker "D:\Workspace\another project"
```

The folder must exist. A new workspace gets graph.json, local skills, agent guidance and ignored .isp tools/state. Existing implementation, graph and customized skills are preserved. The Start menu shortcut opens a folder chooser.

Same-folder commands reuse the existing launcher/server. Other folders get separate ports starting at 4310; PORT changes the starting port and the next 100 ports are considered. Closing a launcher or pressing its stop button stops its server and terminal trees. Folder-specific servers refuse in-place folder switching: run the command in the other folder. Development npm start retains folder switching.

Updates install alongside older app versions under versions/. Close the old launcher before using the new version. Server configuration/discovery lives in `%LOCALAPPDATA%\ISPBlockMaker\state`; diagnostic logs live in `%LOCALAPPDATA%\ISPBlockMaker\logs`. Workspaces stay outside the installation. The bundled Node is available in the server terminal PATH.

Uninstall through Windows installed apps after closing launchers. Only package-owned files are removed. Workspaces and local logs/state are retained. For ZIP deployment, extract and run install.ps1. Use `install.ps1 -NoRegistration` to prepare the local command without changing PATH, shortcuts or registry.

Git, Python and coding agents (including their dependencies and internal endpoints) remain separate prerequisites for those features. This installer is unsigned; organizational signing can be applied before distribution.

# SDD documents

Documentation → SDD 작성 요청 queues a global request; it does not automatically run an agent. The local sdd.md guide directs Overview → Flow → block details in self-contained HTML. Register with `node .isp/tools/isp.mjs document .isp/documents/sdd.html --revision N`. Documentation shows registered versions and an HTML download. Documents remain local artifacts, separate from implementation Git history.
