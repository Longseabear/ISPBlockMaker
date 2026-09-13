import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
try {
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required. Place node.exe beside ISPBlockMaker.exe.");
  for (const file of ["dist/index.html", "server/index.mjs", "templates/project/.agents/skills/isp-block-maker/SKILL.md"])
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}. Use the complete distribution folder; the executable alone is not sufficient.`);
  for (const dependency of ["express", "ws", "zod", "node-pty"]) require.resolve(dependency);
  const runtime = path.join(root, ".isp");
  fs.mkdirSync(runtime, { recursive: true });
  const config = path.join(runtime, "active-workspace.json");
  const workspace = process.env.ISP_DATA_DIR ? path.dirname(process.env.ISP_DATA_DIR) : fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, "utf8")).path : path.join(root, "workspace", "untitled");
  for (const folder of [runtime, workspace]) {
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.isp-write-check-${process.pid}`);
    fs.writeFileSync(probe, "", { flag: "wx" }); fs.unlinkSync(probe);
  }
  const pty = require("node-pty");
  await new Promise((resolve, reject) => {
    const shell = pty.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "exit", "0"], { cwd: workspace, env: process.env, cols: 80, rows: 24 });
    const timer = setTimeout(() => { shell.kill(); reject(new Error("Terminal startup timed out. Check Windows ConPTY support and node-pty native files.")); }, 8000);
    shell.onExit(({exitCode}) => { clearTimeout(timer); exitCode === 0 ? resolve() : reject(new Error(`Terminal probe failed: ${exitCode}`)); });
  });
  console.log(`${new Date().toISOString()} Startup checks passed: Node ${process.versions.node}, dependencies, folder access, terminal.`);
  if (!process.argv.includes("--check")) await import("../server/index.mjs");
} catch (error) {
  console.error(`${new Date().toISOString()} Startup failed: ${error.message}`);
  process.exitCode = 1;
}
