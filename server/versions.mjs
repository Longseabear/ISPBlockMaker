import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import { validateGraph } from "./model.mjs";

const execute = promisify(execFile);
async function git(cwd, args) {
  try {
    const { stdout } = await execute(
      "git",
      ["-c", "core.quotepath=false", ...args],
      {
        cwd,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
    );
    return stdout;
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim());
  }
}
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function metadata(text) {
  const [commit, subject, date, ...body] = text.trimEnd().split("\x00");
  return {
    hash: commit,
    shortHash: commit.slice(0, 8),
    subject,
    date,
    body: body.join("\x00").trim().slice(0, 12000),
  };
}
async function commitInfo(workspace, ref) {
  return metadata(
    await git(workspace, [
      "show",
      "-s",
      "--format=%H%x00%s%x00%cI%x00%b",
      ref,
      "--",
    ]),
  );
}
export async function versionStatus(workspace, history = false) {
  let repo;
  try {
    repo = (await git(workspace, ["rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    if (/not a git repository/i.test(error.message))
      return {
        available: false,
        reason: "선택한 폴더에 Git 저장소가 없습니다.",
      };
    throw error;
  }
  let branch = null,
    head = null;
  try {
    branch = (
      await git(workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    ).trim();
  } catch {}
  try {
    head = await commitInfo(workspace, "HEAD");
  } catch (error) {
    if (!branch) throw error;
  }
  const status = await git(repo, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const raw = status.split("\0").filter(Boolean),
    changes = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    changes.push({ status: item.slice(0, 2), path: item.slice(3) });
    if (/[RC]/.test(item.slice(0, 2))) i++;
  }
  const branches = (
    await git(repo, [
      "for-each-ref",
      "--format=%(refname:short)%00%(objectname)",
      "refs/heads/",
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, commit] = line.trimEnd().split("\0");
      return { name, hash: commit };
    });
  let commits = [];
  if (head && history) {
    commits = (
      await git(repo, [
        "log",
        "--all",
        "--date-order",
        "-50",
        "--format=%H%x00%s%x00%cI%x00%b%x1e",
        "HEAD",
      ])
    )
      .split("\x1e")
      .map((v) => v.trim())
      .filter(Boolean)
      .map(metadata);
  }
  return {
    available: true,
    repo,
    workspace,
    branch,
    detached: !!head && !branch,
    head,
    branches,
    commits,
    dirty: changes.length > 0,
    changeCount: changes.length,
    changes: changes.slice(0, 100),
    snapshot: hash(JSON.stringify({ repo, branch, head: head?.hash, status })),
  };
}
const relativePath = (repo, file) =>
  path.relative(repo, file).split(path.sep).join("/");
function localOnly(file) {
  return /(^|\/)\.isp(\/|$)|(^|\/)artifacts\/generated(\/|$)/.test(file);
}
export async function previewVersion(workspace, target) {
  if (
    !["branch", "commit"].includes(target.kind) ||
    typeof target.ref !== "string" ||
    !target.ref ||
    target.ref.length > 250 ||
    target.ref.startsWith("-")
  )
    throw new Error("올바른 브랜치 또는 커밋을 선택하세요.");
  const current = await versionStatus(workspace);
  if (!current.available || !current.head)
    throw new Error("첫 커밋을 만든 후 버전을 선택할 수 있습니다.");
  const ref =
    target.kind === "branch" ? `refs/heads/${target.ref}` : target.ref;
  const resolved = (
    await git(workspace, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  const commit = await commitInfo(workspace, resolved);
  const graphPath = relativePath(
    current.repo,
    path.join(workspace, "graph.json"),
  );
  let graph;
  try {
    graph = validateGraph(
      JSON.parse(await git(current.repo, ["show", `${resolved}:${graphPath}`])),
    );
  } catch {
    throw new Error(
      "이 버전에 유효한 graph.json이 없습니다. 그래프와 구현이 함께 커밋된 버전을 선택하세요.",
    );
  }
  let previous = null;
  try {
    previous = validateGraph(
      JSON.parse(
        await git(current.repo, ["show", `${current.head.hash}:${graphPath}`]),
      ),
    );
  } catch {}
  const paths = (
    await git(current.repo, [
      "diff",
      "--name-only",
      "-z",
      current.head.hash,
      resolved,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const prefix = relativePath(current.repo, workspace);
  const outside = paths.filter(
    (file) => prefix && !file.startsWith(prefix + "/"),
  );
  const tracked = (
    await git(current.repo, ["ls-tree", "-r", "--name-only", "-z", resolved])
  )
    .split("\0")
    .filter(Boolean);
  const currentTracked = (await git(current.repo, ["ls-files", "-z"]))
    .split("\0")
    .filter(Boolean);
  let blockedReason = current.dirty
    ? "미커밋 변경이 있습니다. 커밋하거나 직접 정리한 후 전환하세요."
    : null;
  if (outside.length)
    blockedReason =
      "작업 폴더 밖의 파일도 바뀌는 버전입니다. 앱 실행 중에는 전환할 수 없습니다.";
  if ([...tracked, ...currentTracked].some(localOnly))
    blockedReason =
      "로컬 기록(.isp 또는 생성 결과물)이 Git에 포함되어 있어 전환할 수 없습니다.";
  const previousBlocks = new Map(
    (previous?.blocks || []).map((b) => [b.id, b]),
  );
  const nextBlocks = new Map(graph.blocks.map((b) => [b.id, b]));
  const changes = {
    added: graph.blocks
      .filter((b) => !previousBlocks.has(b.id))
      .map((b) => ({ id: b.id, name: b.name })),
    removed: (previous?.blocks || [])
      .filter((b) => !nextBlocks.has(b.id))
      .map((b) => ({ id: b.id, name: b.name })),
    modified: graph.blocks
      .filter(
        (b) =>
          previousBlocks.has(b.id) &&
          JSON.stringify(b) !== JSON.stringify(previousBlocks.get(b.id)),
      )
      .map((b) => ({ id: b.id, name: b.name })),
    edgesBefore: previous?.edges.length ?? null,
    edgesAfter: graph.edges.length,
  };
  const stats = await git(current.repo, [
    "diff",
    "--stat",
    current.head.hash,
    resolved,
    "--",
  ]);
  return {
    target,
    commit,
    snapshot: current.snapshot,
    currentHash: current.head.hash,
    repo: current.repo,
    graphChanges: changes,
    files: paths.slice(0, 100),
    fileCount: paths.length,
    stats: stats.slice(0, 18000),
    blockedReason,
    detached: target.kind === "commit",
  };
}
export async function switchVersion(workspace, input, beforeSwitch = () => {}) {
  const preview = await previewVersion(workspace, input.target);
  if (preview.snapshot !== input.snapshot || preview.commit.hash !== input.hash)
    throw new Error(
      "Git 상태나 선택한 브랜치가 바뀌었습니다. 미리보기를 새로고침하세요.",
    );
  if (preview.blockedReason) throw new Error(preview.blockedReason);
  await beforeSwitch();
  // Re-check after stopping terminal activity; never discard/stash user edits.
  const latest = await versionStatus(workspace);
  if (latest.snapshot !== input.snapshot || latest.dirty)
    throw new Error(
      "전환 직전에 작업 내용이 변경되었습니다. 상태를 다시 확인하세요.",
    );
  const args = ["switch", "--no-guess", "--no-overwrite-ignore"];
  if (input.target.kind === "commit")
    args.push("--detach", preview.commit.hash);
  else {
    const now = (
      await git(workspace, [
        "rev-parse",
        "--verify",
        `refs/heads/${input.target.ref}^{commit}`,
      ])
    ).trim();
    if (now !== input.hash)
      throw new Error("브랜치가 변경되었습니다. 다시 선택하세요.");
    args.push(input.target.ref);
  }
  await git(workspace, args);
  return versionStatus(workspace);
}
