import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  versionStatus,
  previewVersion,
  switchVersion,
} from "../server/versions.mjs";
import { initialProject } from "../server/model.mjs";
import { graphSpec, createStore } from "../server/store.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
test(
  "Git version selection reports summaries, preserves local records and guards stale/dirty state",
  { timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-versions-"));
    try {
      assert.equal((await versionStatus(dir)).available, false);
      git(dir, "init", "-b", "main");
      git(dir, "config", "user.name", "ISP test");
      git(dir, "config", "user.email", "isp-test@example.invalid");
      assert.equal((await versionStatus(dir)).head, null);
      const graph = graphSpec(initialProject);
      graph.blocks.forEach((b) => (b.implementation = "shared.py"));
      fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify(graph));
      fs.writeFileSync(
        path.join(dir, "shared.py"),
        "def process():\n    return 1\n",
      );
      fs.writeFileSync(
        path.join(dir, ".gitignore"),
        ".isp/\nartifacts/generated/\n",
      );
      git(dir, "add", "graph.json", "shared.py", ".gitignore");
      git(dir, "commit", "-m", "v1 baseline");
      const v1 = git(dir, "rev-parse", "HEAD");
      const localStore = createStore(
        path.join(dir, ".isp"),
        path.join(dir, "graph.json"),
      );
      localStore.global(
        {
          userRequests: [
            {
              id: "memo",
              text: "Keep local request",
              status: "pending",
              createdAt: new Date().toISOString(),
            },
          ],
          jobs: [],
        },
        localStore.get().revision,
      );
      localStore.artifact({
        id: "result",
        blockId: "denoise",
        title: "Keep result",
      });
      const localBefore = fs.readFileSync(
        path.join(dir, ".isp/project.json"),
        "utf8",
      );
      git(dir, "switch", "-c", "v2");
      graph.blocks[1].parameters.threshold = 0.01;
      fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify(graph));
      fs.writeFileSync(
        path.join(dir, "shared.py"),
        "def process():\n    return 2\n",
      );
      git(dir, "add", "graph.json", "shared.py");
      git(
        dir,
        "commit",
        "-m",
        "v2 threshold update",
        "-m",
        "Raise threshold and change implementation.",
      );
      const v2 = git(dir, "rev-parse", "HEAD");
      git(dir, "switch", "main");
      const status = await versionStatus(dir, true);
      assert.equal(status.branch, "main");
      assert.equal(status.head.hash, v1);
      assert.equal(status.dirty, false);
      assert.equal(status.commits.length, 2);
      const preview = await previewVersion(dir, { kind: "branch", ref: "v2" });
      assert.equal(preview.commit.hash, v2);
      assert.match(preview.commit.body, /threshold/);
      assert.deepEqual(
        preview.graphChanges.modified.map((b) => b.id),
        ["flat-detection"],
      );
      assert.ok(preview.files.includes("shared.py"));
      assert.equal(preview.blockedReason, null);
      const switched = await switchVersion(dir, {
        target: preview.target,
        snapshot: preview.snapshot,
        hash: preview.commit.hash,
      });
      assert.equal(switched.branch, "v2");
      assert.match(
        fs.readFileSync(path.join(dir, "shared.py"), "utf8"),
        /return 2/,
      );
      assert.equal(
        fs.readFileSync(path.join(dir, ".isp/project.json"), "utf8"),
        localBefore,
      );
      const back = await previewVersion(dir, { kind: "commit", ref: v1 });
      assert.equal(
        (
          await switchVersion(dir, {
            target: back.target,
            snapshot: back.snapshot,
            hash: back.commit.hash,
          })
        ).detached,
        true,
      );
      const stale = await previewVersion(dir, { kind: "branch", ref: "v2" });
      fs.appendFileSync(path.join(dir, "shared.py"), "# user edit\n");
      assert.match(
        (await previewVersion(dir, { kind: "branch", ref: "v2" }))
          .blockedReason,
        /미커밋/,
      );
      await assert.rejects(
        switchVersion(dir, {
          target: stale.target,
          snapshot: stale.snapshot,
          hash: stale.commit.hash,
        }),
        /바뀌|미커밋/,
      );
      assert.match(
        fs.readFileSync(path.join(dir, "shared.py"), "utf8"),
        /user edit/,
      );
      fs.writeFileSync(
        path.join(dir, "shared.py"),
        "def process():\n    return 1\n",
      );
      const race = await previewVersion(dir, { kind: "branch", ref: "v2" });
      await assert.rejects(
        switchVersion(
          dir,
          {
            target: race.target,
            snapshot: race.snapshot,
            hash: race.commit.hash,
          },
          () =>
            fs.appendFileSync(path.join(dir, "shared.py"), "# concurrent\n"),
        ),
        /변경/,
      );
      assert.equal(git(dir, "rev-parse", "HEAD"), v1);
      await assert.rejects(
        previewVersion(dir, { kind: "commit", ref: "--help" }),
      );
      const resumed = createStore(
        path.join(dir, ".isp"),
        path.join(dir, "graph.json"),
      ).get();
      assert.equal(
        resumed.globalWork.userRequests[0].text,
        "Keep local request",
      );
      assert.equal(resumed.artifacts.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "Version preview refuses switching files outside the workspace or to missing graphs",
  { timeout: 30000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-version-scope-"));
    const work = path.join(dir, "workspace");
    fs.mkdirSync(work);
    try {
      git(dir, "init", "-b", "main");
      git(dir, "config", "user.name", "ISP test");
      git(dir, "config", "user.email", "isp-test@example.invalid");
      fs.writeFileSync(path.join(dir, "app.txt"), "v1");
      git(dir, "add", "app.txt");
      git(dir, "commit", "-m", "No graph");
      const empty = git(dir, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(work, "graph.json"),
        JSON.stringify(graphSpec(initialProject)),
      );
      git(dir, "add", "workspace/graph.json");
      git(dir, "commit", "-m", "Add graph");
      git(dir, "switch", "-c", "app-change");
      fs.writeFileSync(path.join(dir, "app.txt"), "v2");
      git(dir, "add", "app.txt");
      git(dir, "commit", "-m", "Change app");
      git(dir, "switch", "main");
      assert.match(
        (await previewVersion(work, { kind: "branch", ref: "app-change" }))
          .blockedReason,
        /폴더 밖/,
      );
      await assert.rejects(
        previewVersion(work, { kind: "commit", ref: empty }),
        /graph.json/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
