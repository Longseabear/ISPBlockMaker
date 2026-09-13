#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../scripts/isp.mjs";

const workspace = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const current = fs.realpathSync(process.cwd());
const relative = path.relative(workspace, current);
if (
  relative === ".." ||
  relative.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relative)
) {
  console.error(
    "이 로컬 진입점은 workspace 및 그 하위 디렉터리에서만 실행할 수 있습니다.",
  );
  process.exitCode = 1;
} else {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
