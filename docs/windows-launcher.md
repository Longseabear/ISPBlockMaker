# Windows launcher

Build the frontend with `npm run build`, then build `ISPBlockMaker.exe` with `npm run build:launcher` on Windows. The compiler is the Windows .NET Framework C# compiler. The launcher targets Windows 10/11 with .NET Framework 4.x and a supported Node.js 24+ runtime.

Double-click the EXE in the framework root. It checks the server identity, starts the local server if needed, and opens the default browser. Keep its small window open while working. **서버 종료** or closing the launcher stops the server and its terminal process trees. Clicking the EXE again opens the existing URL without launching a second server. A server for a different framework root on the same port is never stopped. Set the `PORT` environment variable before launching to use another port (default 4310).

The launcher prefers `node.exe` beside the EXE, then searches PATH. Startup checks verify built frontend files, dependencies, writable framework/workspace folders and a real Windows terminal launch. `npm run check:windows` runs the checks without starting the server. Errors and server output are stored under `%LOCALAPPDATA%\ISPBlockMaker\logs`; **로그 폴더** opens it. Logs do not capture terminal input/output or the API token. Browser errors remain in the browser console.

For offline delivery, ship the complete framework folder containing the EXE, compatible Windows `node.exe`, `node_modules` including native node-pty files, `dist`, `server`, `scripts`, `templates` and `package.json`. Build/install these on a connected Windows machine first. The EXE is a launcher, not a single-file bundle; shipping only the EXE will not work. Exclude your `.git`, `.isp` and `workspace` folders. Git/Python/agent programs and their dependencies remain separate prerequisites for their respective features. Automatic installer creation and Python/agent bundling are not implemented here.

# SDD documents

Open **Document화 → SDD 작성 요청** to queue a global request. The agent reads the workspace's `sdd.md` guide, splits the request into JOBs and creates static, self-contained HTML in Overview → Flow → block details order. This button queues work; it does not run an agent automatically.

Register the resulting HTML from the workspace with `node .isp/tools/isp.mjs document .isp/documents/sdd.html --revision N --title "Project SDD"`. The document appears in Document화, with prior versions and an HTML download. Registered documents retain the revision they describe. They are local artifacts, separate from implementation Git history.
