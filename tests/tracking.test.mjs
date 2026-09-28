import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { initialProject } from "../server/model.mjs";
import { graphSpec } from "../server/store.mjs";
import {
  listTracking, createAttempt, updateAttempt, acceptAttempt,
  createCheckpoint, previewRestore, restoreCheckpoint, compareCheckpoints,
} from "../server/tracking.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(t, { split = false, unborn = false } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "isp-tracking-"));
  t.after(() => {
    assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.match(path.basename(workspace), /^isp-tracking-/);
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  const source = split ? path.join(workspace, "project") : workspace;
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(workspace, ".isp"), { recursive: true });
  if (split) fs.writeFileSync(path.join(workspace, ".isp/workspace.json"), JSON.stringify({ version: 1, sourceRoot: "project" }));
  const project = structuredClone(initialProject);
  project.blocks.forEach((block) => {
    block.implementation = "shared.py";
    block.userRequests = [];
    block.jobs = [];
  });
  const makeJob = (id, title) => ({ id, title, description: "Original request", status: "pending", createdAt: "2026-09-17T00:00:00.000Z", resolution: "" });
  project.blocks.find((block) => block.id === "denoise").jobs.push(makeJob("block-job", "Reduce dark-region noise"));
  project.globalWork = { userRequests: [], jobs: [makeJob("global-job", "Check the pipeline")] };
  project.artifacts = [{ id: "result-image", blockId: "denoise", title: "Result comparison", kind: "image", path: ".isp/artifacts/result.png", revision: 1, createdAt: "2026-09-17T00:00:00.000Z" }];
  fs.writeFileSync(path.join(source, "graph.json"), JSON.stringify(graphSpec(project), null, 2));
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 1\n");
  fs.writeFileSync(path.join(source, ".gitignore"), ".isp/\nartifacts/generated/\nignored.txt\n");
  fs.writeFileSync(path.join(workspace, ".isp/project.json"), JSON.stringify({ sentinel: "Keep JOBs and results" }));
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "ISP tracking test");
  git(source, "config", "user.email", "isp-tracking@example.invalid");
  git(source, "config", "core.autocrlf", "false");
  if (!unborn) {
    git(source, "add", "graph.json", "shared.py", ".gitignore");
    git(source, "commit", "-m", "Baseline graph and implementation");
  }
  return { workspace, source, project };
}

test("checkpoints capture working and staged content without changing HEAD, index, or local records", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t);
  const head = git(source, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 'staged'\n");
  git(source, "add", "shared.py");
  const indexTree = git(source, "write-tree");
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 'working'\n");
  fs.writeFileSync(path.join(source, "new.py"), "THRESHOLD = 0.125\n");
  fs.writeFileSync(path.join(source, "ignored.txt"), "Keep this outside the snapshot\n");
  const status = git(source, "status", "--porcelain=v1", "--untracked-files=all");
  const local = fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8");
  const checkpoint = await createCheckpoint(workspace, { title: "Try max-min threshold" });
  assert.equal(checkpoint.sourceHead, head);
  assert.equal(checkpoint.sourceBranch, "main");
  assert.equal(checkpoint.indexTreeHash, indexTree);
  assert.equal(git(source, "show", `${checkpoint.hash}:shared.py`), "def process():\n    return 'working'");
  assert.equal(git(source, "show", `${checkpoint.hash}:new.py`), "THRESHOLD = 0.125");
  assert.equal(git(source, "show", `${checkpoint.indexCommitHash}:shared.py`), "def process():\n    return 'staged'");
  const files = git(source, "ls-tree", "-r", "--name-only", checkpoint.hash).split("\n");
  assert.ok(!files.includes(".isp/project.json"));
  assert.ok(!files.includes("ignored.txt"));
  assert.equal(git(source, "rev-parse", "HEAD"), head);
  assert.equal(git(source, "write-tree"), indexTree);
  assert.equal(git(source, "status", "--porcelain=v1", "--untracked-files=all"), status);
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8"), local);
  const state = await listTracking(workspace, project);
  assert.ok(state.checkpoints.some((item) => item.id === checkpoint.id && item.available));
  assert.equal(state.current.headHash, head);
  assert.equal(state.current.dirty, true);
});

test("fresh unborn repositories can checkpoint and restore without losing staged or untracked source", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t, { split: true, unborn: true });
  const target = await createCheckpoint(workspace, { title: "Before the first commit" });
  assert.equal(target.sourceHead, null);
  assert.equal(target.sourceBranch, "main");
  assert.throws(() => git(source, "rev-parse", "--verify", "HEAD"));
  assert.equal(git(source, "symbolic-ref", "--short", "HEAD"), "main");
  fs.writeFileSync(path.join(source, "shared.py"), "STAGED = 'before first commit'\n");
  git(source, "add", "shared.py");
  const indexTree = git(source, "write-tree");
  fs.writeFileSync(path.join(source, "shared.py"), "WORKING = 'before first commit'\n");
  fs.writeFileSync(path.join(source, "untracked.py"), "UNTRACKED = True\n");
  const localBefore = fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8");
  const preview = await previewRestore(workspace, target.id);
  const restored = await restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot });
  const safety = restored.safetyCheckpoint;
  assert.equal(safety.sourceHead, null);
  assert.equal(safety.sourceBranch, "main");
  assert.equal(safety.indexTreeHash, indexTree);
  assert.equal(git(source, "show", `${safety.indexCommitHash}:shared.py`), "STAGED = 'before first commit'");
  assert.equal(git(source, "show", `${safety.hash}:shared.py`), "WORKING = 'before first commit'");
  assert.equal(git(source, "show", `${safety.hash}:untracked.py`), "UNTRACKED = True");
  assert.equal(safety.recoveryStashHash, undefined);
  assert.equal(git(source, "rev-parse", "HEAD"), target.hash);
  assert.throws(() => git(source, "show-ref", "--verify", "refs/heads/main"));
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "def process():\n    return 1\n");
  assert.equal(fs.existsSync(path.join(source, "untracked.py")), false);
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8"), localBefore);
  assert.equal((await listTracking(workspace, project)).current.checkpointId, target.id);
});

test("force-added ignored source retains both variants and assume-unchanged files block snapshots", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t, { split: true });
  fs.writeFileSync(path.join(source, "ignored.txt"), "Staged ignored implementation\n");
  git(source, "add", "--force", "ignored.txt");
  const indexTree = git(source, "write-tree");
  fs.writeFileSync(path.join(source, "ignored.txt"), "Working ignored implementation\n");
  const checkpoint = await createCheckpoint(workspace, { title: "Force-added source" });
  assert.equal(checkpoint.indexTreeHash, indexTree);
  assert.equal(git(source, "show", `${checkpoint.indexCommitHash}:ignored.txt`), "Staged ignored implementation");
  assert.equal(git(source, "show", `${checkpoint.hash}:ignored.txt`), "Working ignored implementation");
  git(source, "update-index", "--assume-unchanged", "shared.py");
  fs.writeFileSync(path.join(source, "shared.py"), "HIDDEN_WORKING_CHANGE = True\n");
  await assert.rejects(() => createCheckpoint(workspace, { title: "Must not miss hidden changes" }), /assume-unchanged/i);
  const state = await listTracking(workspace, project);
  assert.equal(state.current.available, false);
  assert.match(state.current.reason, /assume-unchanged/i);
  assert.equal(state.checkpoints.length, 1);
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "HIDDEN_WORKING_CHANGE = True\n");
  assert.equal(git(source, "write-tree"), indexTree);
});

test("current checkpoint identity favors the selected commit over a newer identical safety tree", { timeout: 60000 }, async (t) => {
  const { workspace, project } = fixture(t, { split: true });
  const target = await createCheckpoint(workspace, { title: "Chosen implementation" });
  const preview = await previewRestore(workspace, target.id);
  const restored = await restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot });
  assert.equal(restored.safetyCheckpoint.treeHash, target.treeHash);
  const state = await listTracking(workspace, project);
  assert.equal(state.current.headHash, target.hash);
  assert.equal(state.current.checkpointId, target.id);
});

test("concurrent attempt edits require the current record timestamp and explicit baselines must match source", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t, { split: true });
  const baseline = await createCheckpoint(workspace, { title: "Before the experiment" });
  const attempt = await createAttempt(workspace, project, { title: "Shared attempt", baselineCheckpointId: baseline.id });
  const current = await updateAttempt(workspace, project, attempt.id, { summary: "Updated by the agent", expectedUpdatedAt: attempt.updatedAt });
  assert.notEqual(current.updatedAt, attempt.updatedAt);
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { summary: "Older UI draft", expectedUpdatedAt: attempt.updatedAt }), /changed elsewhere/i);
  const stored = (await listTracking(workspace, project)).attempts.find((item) => item.id === attempt.id);
  assert.equal(stored.summary, "Updated by the agent");
  fs.writeFileSync(path.join(source, "shared.py"), "DIFFERENT_SOURCE = True\n");
  await assert.rejects(() => createAttempt(workspace, project, { title: "Wrong baseline", baselineCheckpointId: baseline.id }));
  assert.equal((await listTracking(workspace, project)).attempts.length, 1);
});

test("attempts link scoped JOBs, freeze their inputs, complete with result snapshots, and accept independently of checkout", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t, { split: true });
  const attempt = await createAttempt(workspace, project, {
    title: "Max-min experiment", approach: "Use the local range instead of variance",
    blockIds: ["denoise"], jobRefs: [{ blockId: "denoise", jobId: "block-job" }, { blockId: null, jobId: "global-job" }],
    inputConditions: "12-bit GRBG; fixed synthetic input",
  });
  assert.equal(attempt.status, "in_progress");
  assert.ok(attempt.baselineCheckpointId);
  assert.equal(attempt.jobSnapshots.length, 2);
  assert.match(JSON.stringify(attempt.jobSnapshots), /Reduce dark-region noise/);
  assert.match(JSON.stringify(attempt.parameterSnapshot), /0\.85/);
  project.blocks.find((block) => block.id === "denoise").jobs[0].title = "Changed after the attempt started";
  project.blocks.find((block) => block.id === "denoise").parameters.strength = 0.5;
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 2\n");
  const completed = await updateAttempt(workspace, project, attempt.id, {
    status: "completed", summary: "Range threshold preserves edges", validation: ["Noise fixture passes"], artifactIds: ["result-image"],
  });
  assert.ok(completed.resultCheckpointId);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.artifactIds, ["result-image"]);
  assert.match(JSON.stringify(completed.jobSnapshots), /Reduce dark-region noise/);
  assert.doesNotMatch(JSON.stringify(completed.jobSnapshots), /Changed after/);
  assert.match(JSON.stringify(completed.parameterSnapshot), /0\.85/);
  const headBeforeAccept = git(source, "rev-parse", "HEAD");
  const statusBeforeAccept = git(source, "status", "--porcelain=v1");
  await acceptAttempt(workspace, attempt.id);
  const state = await listTracking(workspace, project);
  assert.equal(state.acceptedAttemptId, attempt.id);
  assert.equal(state.lastAttemptId, attempt.id);
  assert.equal(git(source, "rev-parse", "HEAD"), headBeforeAccept);
  assert.equal(git(source, "status", "--porcelain=v1"), statusBeforeAccept);
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { summary: "Rewrite history" }));
  const comparison = await compareCheckpoints(workspace, attempt.baselineCheckpointId, completed.resultCheckpointId);
  assert.match(JSON.stringify(comparison), /shared\.py/);
});

test("attempt validation rejects missing references and invalid lifecycle transitions without inventing records", { timeout: 60000 }, async (t) => {
  const { workspace, project } = fixture(t);
  for (const input of [
    { title: "Unknown block", blockIds: ["missing"], jobRefs: [] },
    { title: "Unknown JOB", jobRefs: [{ blockId: "denoise", jobId: "missing" }] },
    { title: "Wrong JOB scope", jobRefs: [{ blockId: null, jobId: "block-job" }] },
    { title: "Unknown baseline", jobRefs: [], baselineCheckpointId: "missing" },
  ]) await assert.rejects(() => createAttempt(workspace, project, input));
  assert.equal((await listTracking(workspace, project)).attempts.length, 0);
  const attempt = await createAttempt(workspace, project, { title: "Try smaller window", jobRefs: [] });
  await assert.rejects(() => acceptAttempt(workspace, attempt.id));
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { status: "completed", summary: "   " }));
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { artifactIds: ["missing"] }));
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { resultCheckpointId: "missing" }));
  const failed = await updateAttempt(workspace, project, attempt.id, { status: "failed", summary: "Validation failed" });
  assert.equal(failed.status, "failed");
  await assert.rejects(() => acceptAttempt(workspace, attempt.id));
  await assert.rejects(() => updateAttempt(workspace, project, attempt.id, { status: "in_progress" }));
});

test("restore protects dirty source and its staged variant, while retaining workspace JOBs and results", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t, { split: true });
  const target = await createCheckpoint(workspace, { title: "Known working implementation" });
  const originalHead = git(source, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 'staged recovery'\n");
  git(source, "add", "shared.py");
  const originalIndex = git(source, "write-tree");
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 'working recovery'\n");
  fs.writeFileSync(path.join(source, "new-work.py"), "KEEP = True\n");
  fs.writeFileSync(path.join(source, "ignored.txt"), "Untracked ignored data\n");
  fs.writeFileSync(path.join(workspace, ".isp/local-result.html"), "<p>Preserved visualization</p>");
  const localBefore = fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8");
  const preview = await previewRestore(workspace, target.id);
  assert.ok(!preview.blockedReason, preview.blockedReason);
  let stopped = 0;
  const result = await restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot }, async () => { stopped++; });
  assert.equal(stopped, 1);
  assert.equal(result.checkpoint.id, target.id);
  assert.ok(result.safetyCheckpoint);
  const safety = result.safetyCheckpoint;
  assert.equal(safety.sourceHead, originalHead);
  assert.equal(safety.sourceBranch, "main");
  assert.equal(safety.indexTreeHash, originalIndex);
  assert.equal(git(source, "show", `${safety.hash}:shared.py`), "def process():\n    return 'working recovery'");
  assert.equal(git(source, "show", `${safety.indexCommitHash}:shared.py`), "def process():\n    return 'staged recovery'");
  assert.equal(git(source, "show", `${safety.hash}:new-work.py`), "KEEP = True");
  assert.ok(safety.recoveryStashHash);
  assert.equal(git(source, "rev-parse", `refs/isp/recovery/${safety.id}`), safety.recoveryStashHash);
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "def process():\n    return 1\n");
  assert.equal(fs.existsSync(path.join(source, "new-work.py")), false);
  assert.equal(fs.readFileSync(path.join(source, "ignored.txt"), "utf8"), "Untracked ignored data\n");
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8"), localBefore);
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/local-result.html"), "utf8"), "<p>Preserved visualization</p>");
  assert.equal(git(source, "rev-parse", "HEAD"), target.hash);
  assert.equal((await listTracking(workspace, project)).current.checkpointId, target.id);
});

test("stopping a terminal cannot silently invalidate an approved restore preview", { timeout: 60000 }, async (t) => {
  const { workspace, source } = fixture(t, { split: true });
  const target = await createCheckpoint(workspace, { title: "Stable version" });
  const preview = await previewRestore(workspace, target.id);
  const originalHead = git(source, "rev-parse", "HEAD");
  await assert.rejects(() => restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot }, () => {
    fs.writeFileSync(path.join(source, "shared.py"), "Saved just before process exit\n");
  }));
  assert.equal(git(source, "rev-parse", "HEAD"), originalHead);
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "Saved just before process exit\n");
});

test("legacy repositories without local-state ignore rules keep .isp and tmp files through restore", { timeout: 60000 }, async (t) => {
  const { workspace, source } = fixture(t);
  fs.writeFileSync(path.join(source, ".gitignore"), "ignored.txt\n");
  git(source, "add", ".gitignore");
  git(source, "commit", "-m", "User repository without ISP ignore rules");
  fs.mkdirSync(path.join(workspace, "tmp"));
  fs.writeFileSync(path.join(workspace, "tmp/input.raw"), "Keep intermediate bytes\n");
  const target = await createCheckpoint(workspace, { title: "Before experiment" });
  fs.writeFileSync(path.join(source, "shared.py"), "def process():\n    return 'experiment'\n");
  fs.writeFileSync(path.join(source, "extra.py"), "EXTRA = True\n");
  const localBefore = fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8");
  const preview = await previewRestore(workspace, target.id);
  const result = await restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot });
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/project.json"), "utf8"), localBefore);
  assert.equal(fs.readFileSync(path.join(workspace, "tmp/input.raw"), "utf8"), "Keep intermediate bytes\n");
  assert.ok(fs.existsSync(path.join(workspace, ".isp/tracking.json")));
  assert.equal(git(source, "show", `${result.safetyCheckpoint.hash}:extra.py`), "EXTRA = True");
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "def process():\n    return 1\n");
});

test("restore preview becomes stale when dirty file contents change without a Git status change", { timeout: 60000 }, async (t) => {
  const { workspace, source } = fixture(t);
  const target = await createCheckpoint(workspace, { title: "Baseline" });
  fs.writeFileSync(path.join(source, "shared.py"), "first dirty content\n");
  const beforeStatus = git(source, "status", "--porcelain=v1");
  const preview = await previewRestore(workspace, target.id);
  fs.writeFileSync(path.join(source, "shared.py"), "other dirty content\n");
  assert.equal(git(source, "status", "--porcelain=v1"), beforeStatus);
  let callbackCalled = false;
  await assert.rejects(() => restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot }, () => { callbackCalled = true; }));
  assert.equal(callbackCalled, false);
  assert.equal(fs.readFileSync(path.join(source, "shared.py"), "utf8"), "other dirty content\n");
});

test("restore refuses to overwrite ignored files that become tracked in the selected checkpoint", { timeout: 60000 }, async (t) => {
  const { workspace, source } = fixture(t);
  fs.writeFileSync(path.join(source, "collision.txt"), "Versioned implementation resource\n");
  git(source, "add", "collision.txt");
  git(source, "commit", "-m", "Include resource");
  const target = await createCheckpoint(workspace, { title: "With resource" });
  git(source, "rm", "collision.txt");
  fs.appendFileSync(path.join(source, ".gitignore"), "collision.txt\n");
  git(source, "add", ".gitignore");
  git(source, "commit", "-m", "Resource becomes external input");
  fs.writeFileSync(path.join(source, "collision.txt"), "Precious local input\n");
  const head = git(source, "rev-parse", "HEAD");
  const preview = await previewRestore(workspace, target.id);
  assert.ok(preview.blockedReason);
  await assert.rejects(() => restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot }));
  assert.equal(fs.readFileSync(path.join(source, "collision.txt"), "utf8"), "Precious local input\n");
  assert.equal(git(source, "rev-parse", "HEAD"), head);
});

test("restore blocks an ignored directory junction in the path of checkpoint files", { timeout: 60000 }, async (t) => {
  const { workspace, source } = fixture(t);
  fs.mkdirSync(path.join(source, "resources"));
  fs.writeFileSync(path.join(source, "resources/kernel.py"), "KERNEL = 3\n");
  git(source, "add", "resources/kernel.py");
  git(source, "commit", "-m", "Include kernel resource");
  const target = await createCheckpoint(workspace, { title: "With kernel resource" });
  git(source, "rm", "-r", "resources");
  fs.appendFileSync(path.join(source, ".gitignore"), "resources/\n");
  git(source, "add", ".gitignore");
  git(source, "commit", "-m", "External resource directory");
  const external = path.join(workspace, ".isp/external-input");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "kernel.py"), "PRECIOUS_INPUT = True\n");
  try {
    fs.symlinkSync(external, path.join(source, "resources"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Filesystem cannot create a junction/symlink");
    throw error;
  }
  const preview = await previewRestore(workspace, target.id);
  assert.ok(preview.blockedReason);
  await assert.rejects(() => restoreCheckpoint(workspace, { checkpointId: target.id, snapshot: preview.snapshot }));
  assert.equal(fs.readFileSync(path.join(external, "kernel.py"), "utf8"), "PRECIOUS_INPUT = True\n");
  assert.ok(fs.lstatSync(path.join(source, "resources")).isSymbolicLink());
});

test("invalid graph snapshots are rejected and missing Git objects do not hide remaining tracking records", { timeout: 60000 }, async (t) => {
  const { workspace, source, project } = fixture(t);
  const checkpoint = await createCheckpoint(workspace, { title: "Recoverable metadata" });
  fs.writeFileSync(path.join(source, "graph.json"), "{not valid json");
  await assert.rejects(() => createCheckpoint(workspace, { title: "Broken graph" }));
  git(source, "restore", "graph.json");
  const objectPath = path.join(source, ".git/objects", checkpoint.hash.slice(0, 2), checkpoint.hash.slice(2));
  assert.ok(fs.existsSync(objectPath));
  fs.unlinkSync(objectPath);
  const unavailable = await listTracking(workspace, project);
  assert.equal(unavailable.checkpoints.find((item) => item.id === checkpoint.id).available, false);
  fs.renameSync(path.join(source, ".git"), path.join(source, ".git-disabled"));
  const noGit = await listTracking(workspace, project);
  assert.equal(noGit.current.available, false);
  assert.equal(noGit.checkpoints.length, 1);
  assert.equal(noGit.checkpoints[0].available, false);
});
