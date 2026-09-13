#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { blockSchema } from "../server/model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function connection() {
  if (process.env.ISP_API_URL && process.env.ISP_API_TOKEN)
    return { url: process.env.ISP_API_URL, token: process.env.ISP_API_TOKEN };
  const file = path.join(root, ".isp", "connection.json");
  if (!fs.existsSync(file))
    throw new Error("ISP 서버를 먼저 시작하세요: npm run dev");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    value.workspace &&
    fs.realpathSync(process.cwd()) !== fs.realpathSync(root)
  ) {
    const relative = path.relative(
      fs.realpathSync(value.workspace),
      fs.realpathSync(process.cwd()),
    );
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error(
        "서버의 작업 폴더가 변경되었습니다. 현재 폴더의 서버 연결을 확인하세요.",
      );
  }
  return value;
}
export function localConnection(value) {
  const parsed = new URL(value.url);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "ISP bridge는 로컬 loopback HTTP 주소만 사용할 수 있습니다.",
    );
  return { ...value, url: parsed.origin };
}
export async function request(endpoint, options = {}) {
  const { url, token } = localConnection(connection());
  const response = await fetch(`${url}/api${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error((await response.json()).error || response.statusText);
  return response.headers.get("content-type")?.includes("json")
    ? response.json()
    : response.text();
}
export async function registerArtifact(
  file,
  { blockId, revision, title, runId, metadata } = {},
) {
  const extension = path.extname(file).toLowerCase();
  const kind = {
    ".html": "html",
    ".htm": "html",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".webp": "webp",
  }[extension];
  if (!kind) throw new Error("지원 형식: HTML, PNG, JPEG, WebP");
  if (fs.statSync(file).size > 10 * 1024 * 1024)
    throw new Error("결과물은 10MB 이하여야 합니다.");
  return request("/artifacts", {
    method: "POST",
    body: JSON.stringify({
      title: title || path.basename(file),
      blockId,
      revision,
      runId,
      metadata,
      kind,
      content: fs.readFileSync(file).toString("base64"),
    }),
  });
}
export async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const blockId = option("block") || process.env.ISP_BLOCK_ID;
  if (args.includes("--global") && option("block"))
    throw new Error("--global과 --block은 함께 사용할 수 없습니다.");
  let result;
  if (command === "summary") result = await request("/activity/summaries", {method:"POST",body:JSON.stringify(JSON.parse(fs.readFileSync(args[0],"utf8")))});
  else if (command === "context")
    result = await request(
      `/context${!args.includes("--selection") && blockId ? `?blockId=${encodeURIComponent(blockId)}` : ""}`,
    );
  else if (command === "project") result = await request("/project");
  else if (command === "requests") {
    const query = new URLSearchParams({
      status: args.includes("--all") ? "all" : "pending",
    });
    // This command intentionally ignores the terminal's pinned block.
    if (option("block")) query.set("blockId", option("block"));
    if (args.includes("--global")) query.set("scope", "global");
    result = await request(`/requests?${query}`);
  } else if (command === "jobs") {
    const query = new URLSearchParams({
      status: args.includes("--all") ? "all" : "open",
    });
    if (option("block")) query.set("blockId", option("block"));
    if (args.includes("--global")) query.set("scope", "global");
    result = await request(`/jobs?${query}`);
  } else if (
    ["split-request", "start-job", "complete-job", "reopen-job"].includes(
      command,
    )
  ) {
    const revision = Number(option("revision"));
    if (
      !args[0] ||
      args[0].startsWith("--") ||
      (!option("block") && !args.includes("--global")) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw new Error(
        `${command} ID --block BLOCK_ID --revision N 이 필요합니다.`,
      );
    const base = args.includes("--global")
      ? "/global"
      : `/blocks/${encodeURIComponent(option("block"))}`;
    if (command === "split-request") {
      if (!option("file"))
        throw new Error("--file jobs.json에 JOB 배열을 지정하세요.");
      result = await request(
        `${base}/requests/${encodeURIComponent(args[0])}/jobs`,
        {
          method: "POST",
          body: JSON.stringify({
            revision,
            jobs: JSON.parse(fs.readFileSync(option("file"), "utf8")),
          }),
        },
      );
    } else {
      result = await request(`${base}/jobs/${encodeURIComponent(args[0])}`, {
        method: "PATCH",
        body: JSON.stringify({
          revision,
          status:
            command === "start-job"
              ? "in_progress"
              : command === "complete-job"
                ? "done"
                : "pending",
          resolution: option("note") || "",
        }),
      });
    }
  } else if (command === "consume-request") {
    const revision = Number(option("revision"));
    if (
      !args[0] ||
      args[0].startsWith("--") ||
      !option("block") ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !option("note")
    )
      throw new Error(
        '사용법: isp consume-request REQUEST_ID --block BLOCK_ID --revision N --note "구현 및 검증 내용"',
      );
    result = await request(
      `/blocks/${encodeURIComponent(option("block"))}/requests/${encodeURIComponent(args[0])}/consume`,
      {
        method: "POST",
        body: JSON.stringify({ revision, resolution: option("note") }),
      },
    );
  } else if (command === "mermaid") result = await request("/mermaid");
  else if (command === "present") {
    const artifactId = option("artifact");
    const ids = option("blocks") || option("block");
    const edges = option("edges") || option("edge");
    if (artifactId && (ids || edges || args.includes("--graph")))
      throw new Error("--artifact와 그래프 대상을 함께 지정할 수 없습니다.");
    if (!artifactId && !ids && !edges && !args.includes("--graph"))
      throw new Error(
        "사용법: isp present --blocks ID,ID | --edges ID,ID | --artifact ID | --graph [--message TEXT]",
      );
    result = await request("/present", {
      method: "POST",
      body: JSON.stringify({
        view: artifactId ? "artifacts" : "graph",
        artifactId,
        blockIds: ids ? ids.split(",").filter(Boolean) : [],
        edgeIds: edges ? edges.split(",").filter(Boolean) : [],
        message: option("message") || "",
      }),
    });
  } else if (
    ["add-block", "delete-block", "connect", "disconnect"].includes(command)
  ) {
    const revision = Number(option("revision"));
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error("--revision N에 조회한 프로젝트 revision을 지정하세요.");
    const state = await request("/project");
    if (state.revision !== revision)
      throw new Error(
        "revision 충돌: isp project로 다시 읽고 변경 내용을 재검토하세요.",
      );
    if (command === "add-block") {
      if (!args[0] || args[0].startsWith("--"))
        throw new Error("사용법: isp add-block block.json --revision N");
      const spec = JSON.parse(fs.readFileSync(args[0], "utf8"));
      const block = blockSchema.parse({
        description: "",
        principle: "",
        implementation: "",
        status: "draft",
        inputs: [],
        outputs: [],
        parameters: {},
        position: { x: 300, y: 300 },
        ...spec,
      });
      if (state.blocks.some((b) => b.id === block.id))
        throw new Error("이미 존재하는 블록 ID입니다.");
      state.blocks.push(block);
    } else if (command === "delete-block") {
      const id = args[0];
      if (!id || id.startsWith("--") || !state.blocks.some((b) => b.id === id))
        throw new Error(
          "사용법: isp delete-block ID --revision N (존재하는 ID 필요)",
        );
      if (state.blocks.length === 1)
        throw new Error("마지막 블록은 삭제할 수 없습니다.");
      const edges = state.edges.filter(
        (e) => e.source === id || e.target === id,
      );
      if (edges.length && !args.includes("--with-edges"))
        throw new Error(
          "연결된 간선이 있습니다. disconnect로 해제하거나 --with-edges를 지정하세요.",
        );
      state.blocks = state.blocks.filter((b) => b.id !== id);
      state.edges = state.edges.filter(
        (e) => e.source !== id && e.target !== id,
      );
    } else if (command === "connect") {
      const parsePort = (value) => {
        const match = /^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/.exec(value || "");
        if (!match)
          throw new Error(
            "사용법: isp connect SOURCE:PORT TARGET:PORT --revision N [--id EDGE_ID]",
          );
        return match.slice(1);
      };
      const [source, sourceHandle] = parsePort(args[0]);
      const [target, targetHandle] = parsePort(args[1]);
      state.edges.push({
        id: option("id") || `edge-${crypto.randomUUID()}`,
        source,
        sourceHandle,
        target,
        targetHandle,
      });
    } else {
      if (!state.edges.some((e) => e.id === args[0]))
        throw new Error(
          "사용법: isp disconnect EDGE_ID --revision N (존재하는 ID 필요)",
        );
      state.edges = state.edges.filter((e) => e.id !== args[0]);
    }
    result = await request("/project", {
      method: "PUT",
      body: JSON.stringify(state),
    });
  } else if (command === "update") {
    if (!args[0] || args[0].startsWith("--") || !blockId || !option("revision"))
      throw new Error("사용법: isp update patch.json --block ID --revision N");
    result = await request(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        revision: Number(option("revision")),
        patch: JSON.parse(fs.readFileSync(args[0], "utf8")),
      }),
    });
  } else if (command === "artifact") {
    if (!args[0] || args[0].startsWith("--") || !blockId || !option("revision"))
      throw new Error(
        "사용법: isp artifact result.html --block ID --revision N [--title 제목] [--run ID]",
      );
    result = await registerArtifact(path.resolve(args[0]), {
      blockId,
      revision: Number(option("revision")),
      title: option("title"),
      runId: option("run"),
    });
  } else if (command === "demo") {
    const { runDemo } = await import(pathToFileURL(path.join((await request("/bootstrap")).workspace, "examples/denoise.mjs")).href);
    result = await runDemo();
  } else if (command === "help")
    result = `ISP Block Maker bridge — HTTP, no MCP required

isp context                     Read the terminal's pinned block and neighbors
isp context --selection         Read the block currently selected in the UI
isp requests                     List pending user requests across ALL blocks
isp requests --all --block ID     Include consumed requests for a block
isp split-request ID --block BLOCK_ID --revision N --file jobs.json
isp jobs                         List unfinished JOBs across blocks and global scope
isp requests --global            List graph-wide requests
isp jobs --global                List graph-wide JOBs
isp split-request ID --global --revision N --file jobs.json
isp complete-job ID --global --revision N --note "Validation and commit"
isp jobs --all --block ID         Include completed JOBs
isp start-job ID --block BLOCK_ID --revision N
isp complete-job ID --block BLOCK_ID --revision N --note "Implementation and validation"
isp reopen-job ID --block BLOCK_ID --revision N --note "Remaining work"
isp consume-request ID --block BLOCK_ID --revision N --note "Implemented and validated"
isp context --block ID           Read a specific block
isp project                     Read the whole project
isp add-block block.json --revision N
isp delete-block ID --revision N [--with-edges]
isp connect SOURCE:PORT TARGET:PORT --revision N [--id EDGE_ID]
isp disconnect EDGE_ID --revision N
isp present --blocks ID,ID --message "Updated blocks"
isp present --edges EDGE_ID,EDGE_ID --message "Updated connections"
isp present --artifact ARTIFACT_ID --message "Comparison ready"
isp present --graph
isp update patch.json --block ID --revision N
isp artifact result.html --block ID --revision N --title "Comparison"
isp mermaid                     Export the graph as Mermaid
isp summary summary.json        Record work summary, verification and related IDs
isp demo                        Run the synthetic flat-detection / denoise example

Outside the web terminal: npm run isp -- context
Inside an agent shell: node "$ISP_CLI" context (PowerShell: node $env:ISP_CLI context)
HTML artifacts must be self-contained; external resources and network access are blocked.`;
  else throw new Error(`알 수 없는 명령: ${command}. isp help를 실행하세요.`);
  console.log(
    typeof result === "string" ? result : JSON.stringify(result, null, 2),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
