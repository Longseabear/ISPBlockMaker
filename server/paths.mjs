import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function serverPaths(root, env = process.env) {
  const base = env.ISP_STATE_HOME || path.join(env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "ISPBlockMaker", "state");
  const key = value => crypto.createHash("sha256").update(process.platform === "win32" ? value.toLowerCase() : value).digest("hex").slice(0,32);
  const explicit = env.ISP_WORKSPACE ? fs.realpathSync(path.resolve(env.ISP_WORKSPACE)) : null;
  const runtime = path.join(base, key(explicit || root));
  const config = path.join(runtime, "active-workspace.json");
  const legacy = path.join(root, ".isp", "active-workspace.json");
  const saved = fs.existsSync(config) ? config : legacy;
  const workspace = explicit || (env.ISP_DATA_DIR ? path.dirname(env.ISP_DATA_DIR) : fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved,"utf8")).path : path.join(os.homedir(), "ISPWorkspaces", "untitled"));
  return {runtime, workspaceConfig:config, initialFolder:workspace};
}
