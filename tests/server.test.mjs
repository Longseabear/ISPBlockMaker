import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createStore } from "../server/store.mjs";

test(
  "local API authenticates, validates writes, serves isolated artifacts and streams shell I/O",
  { timeout: 60000 },
  async () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isp-api-test-"));
    const dir = path.join(testRoot, ".isp");
    createStore(dir, path.join(testRoot, "graph.json"));
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        ISP_DATA_DIR: dir,
        ISP_NO_DISCOVERY: "1",
        PORT: String(port),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let ws;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Server start timeout")),
          15000,
        );
        child.stdout.on("data", (data) => {
          if (String(data).includes("ISP Block Maker")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited ${code}`));
        });
      });
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(`${base}/api/project`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/api/bootstrap`, {
            headers: { Origin: "https://untrusted.example" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/api/bootstrap`, {
            headers: { "Sec-Fetch-Site": "cross-site" },
          })
        ).status,
        403,
      );
      const { token, state } = await (
        await fetch(`${base}/api/bootstrap`)
      ).json();
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const write = async (body) =>
        fetch(`${base}/api/project`, {
          method: "PUT",
          headers,
          body: JSON.stringify(body),
        });
      assert.equal((await write({ ...state, name: "API edit" })).status, 200);
      assert.equal((await write(state)).status, 409);
      const cliFile = path.join(dir, "tools/isp.mjs");
      const cliEnv = {
        ...process.env,
        ISP_API_URL: base,
        ISP_API_TOKEN: token,
      };
      const cli = async (...args) => {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [cliFile, ...args],
          {
            cwd: path.join(testRoot, ".agents"),
            env: cliEnv,
            windowsHide: true,
          },
        );
        return JSON.parse(stdout);
      };
      const specFile = path.join(testRoot, "block.json");
      fs.writeFileSync(
        specFile,
        JSON.stringify({
          id: "cli-block",
          name: "CLI block",
          inputs: [{ id: "image", name: "Image", type: "image" }],
          outputs: [],
        }),
      );
      let graph = await cli("add-block", specFile, "--revision", "2");
      assert.equal(graph.blocks.length, 4);
      await assert.rejects(
        cli("delete-block", "cli-block", "--revision", "2"),
        /revision/,
      );
      graph = await cli(
        "connect",
        "input:image",
        "cli-block:image",
        "--id",
        "cli-edge",
        "--revision",
        String(graph.revision),
      );
      await assert.rejects(
        cli("delete-block", "cli-block", "--revision", String(graph.revision)),
        /with-edges/,
      );
      graph = await cli(
        "disconnect",
        "cli-edge",
        "--revision",
        String(graph.revision),
      );
      graph = await cli(
        "connect",
        "input:image",
        "cli-block:image",
        "--revision",
        String(graph.revision),
      );
      graph = await cli(
        "delete-block",
        "cli-block",
        "--with-edges",
        "--revision",
        String(graph.revision),
      );
      assert.equal(graph.blocks.length, 3);
      assert.equal(graph.edges.length, 3);
      // Reading requests is non-destructive and spans every block, independent of selection.
      assert.deepEqual((await cli("requests")).requests, []);
      const memo = {
        id: "memo-test",
        text: "Implement threshold control",
        status: "pending",
        createdAt: new Date().toISOString(),
        resolution: "",
      };
      let response = await fetch(`${base}/api/blocks/denoise`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          revision: graph.revision,
          patch: { userRequests: [memo] },
        }),
      });
      assert.equal(response.status, 200);
      graph = await response.json();
      const listed = await cli("requests");
      assert.equal(listed.requests[0].blockId, "denoise");
      assert.deepEqual(await cli("requests"), listed);
      assert.deepEqual(
        (await cli("requests", "--block", "input")).requests,
        [],
      );
      assert.equal(
        (await cli("context", "--block", "denoise")).agent.userRequests[0].text,
        memo.text,
      );
      const oldRevision = graph.revision;
      // User changes a memo while an agent works: stale completion must not consume the new text.
      response = await fetch(`${base}/api/blocks/denoise`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          revision: graph.revision,
          patch: { userRequests: [{ ...memo, text: "Revised request" }] },
        }),
      });
      graph = await response.json();
      await assert.rejects(
        cli(
          "consume-request",
          memo.id,
          "--block",
          "denoise",
          "--revision",
          String(oldRevision),
          "--note",
          "Done",
        ),
      );
      assert.equal((await cli("requests")).requests[0].text, "Revised request");
      await assert.rejects(
        cli(
          "consume-request",
          "missing",
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
          "--note",
          "Done",
        ),
        /not found/,
      );
      graph = await cli(
        "consume-request",
        memo.id,
        "--block",
        "denoise",
        "--revision",
        String(graph.revision),
        "--note",
        "Implemented; reference validation passed",
      );
      assert.deepEqual((await cli("requests")).requests, []);
      const history = (await cli("requests", "--all")).requests[0];
      assert.equal(history.status, "consumed");
      assert.equal(history.text, "Revised request");
      assert.ok(history.consumedAt);
      assert.match(history.resolution, /validation/);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, "project.json"))).blocks.find(
          (b) => b.id === "denoise",
        ).userRequests[0].status,
        "consumed",
      );
      await assert.rejects(
        cli(
          "consume-request",
          memo.id,
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
          "--note",
          "Done",
        ),
        /소비/,
      );
      const htmlFile = path.join(testRoot, "cli-result.html");
      const globalSpecBefore = fs.readFileSync(
        path.join(testRoot, "graph.json"),
        "utf8",
      );
      response = await fetch(`${base}/api/global`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          revision: graph.revision,
          patch: {
            userRequests: [
              {
                ...memo,
                id: "global-request",
                text: "Compare the complete pipeline",
              },
            ],
          },
        }),
      });
      assert.equal(response.status, 200);
      graph = await response.json();
      const globalRequests = await cli("requests", "--global");
      assert.equal(globalRequests.requests[0].scope, "global");
      assert.equal(globalRequests.requests[0].blockId, null);
      assert.ok(
        (await cli("requests")).requests.some((r) => r.scope === "global"),
      );
      assert.equal(
        (await cli("requests", "--block", "denoise")).requests.length,
        0,
      );
      const globalJobsFile = path.join(testRoot, "global-jobs.json");
      fs.writeFileSync(
        globalJobsFile,
        JSON.stringify([{ title: "Whole pipeline comparison" }]),
      );
      graph = await cli(
        "split-request",
        "global-request",
        "--global",
        "--revision",
        String(graph.revision),
        "--file",
        globalJobsFile,
      );
      const globalJob = (await cli("jobs", "--global")).jobs[0];
      assert.equal(globalJob.scope, "global");
      assert.ok((await cli("jobs")).jobs.some((j) => j.id === globalJob.id));
      graph = await cli(
        "start-job",
        globalJob.id,
        "--global",
        "--revision",
        String(graph.revision),
      );
      graph = await cli(
        "complete-job",
        globalJob.id,
        "--global",
        "--revision",
        String(graph.revision),
        "--note",
        "Compared and validated",
      );
      assert.equal((await cli("jobs", "--global")).jobs.length, 0);
      assert.equal(
        (await cli("jobs", "--global", "--all")).jobs[0].status,
        "done",
      );
      response = await fetch(`${base}/api/global/jobs/${globalJob.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ revision: graph.revision - 1 }),
      });
      assert.equal(response.status, 409);
      response = await fetch(`${base}/api/global/jobs/${globalJob.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ revision: graph.revision }),
      });
      assert.equal(response.status, 200);
      graph = await response.json();
      await assert.rejects(
        cli(
          "complete-job",
          globalJob.id,
          "--global",
          "--revision",
          String(graph.revision),
          "--note",
          "Done",
        ),
        /not found/,
      );
      assert.equal(
        fs.readFileSync(path.join(testRoot, "graph.json"), "utf8"),
        globalSpecBefore,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, "project.json"))).globalWork
          .userRequests[0].id,
        "global-request",
      );
      const requestId = "split-test";
      response = await fetch(`${base}/api/blocks/denoise`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          revision: graph.revision,
          patch: {
            userRequests: [
              ...graph.blocks.find((b) => b.id === "denoise").userRequests,
              {
                ...memo,
                id: requestId,
                text: "Implement threshold and compare output",
              },
            ],
          },
        }),
      });
      graph = await response.json();
      const jobsFile = path.join(testRoot, "jobs.json");
      fs.writeFileSync(
        jobsFile,
        JSON.stringify([
          { title: "Threshold", description: "Validate threshold boundaries" },
          { title: "Comparison" },
        ]),
      );
      const splitRevision = graph.revision;
      await assert.rejects(
        cli(
          "split-request",
          requestId,
          "--block",
          "denoise",
          "--revision",
          String(splitRevision - 1),
          "--file",
          jobsFile,
        ),
      );
      assert.equal((await cli("jobs")).jobs.length, 0);
      graph = await cli(
        "split-request",
        requestId,
        "--block",
        "denoise",
        "--revision",
        String(splitRevision),
        "--file",
        jobsFile,
      );
      await assert.rejects(
        cli(
          "split-request",
          requestId,
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
          "--file",
          jobsFile,
        ),
        /소비/,
      );
      assert.deepEqual((await cli("requests")).requests, []);
      const jobList = await cli("jobs");
      assert.equal(jobList.jobs.length, 2);
      assert.deepEqual(await cli("jobs"), jobList);
      const [firstJob, secondJob] = jobList.jobs;
      assert.equal(firstJob.sourceRequestId, requestId);
      assert.equal(
        (await cli("context", "--block", "denoise")).agent.jobs.length,
        2,
      );
      graph = await cli(
        "start-job",
        firstJob.id,
        "--block",
        "denoise",
        "--revision",
        String(graph.revision),
      );
      await assert.rejects(
        cli(
          "start-job",
          firstJob.id,
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
        ),
      );
      const beforeDelete = graph.revision;
      response = await fetch(
        `${base}/api/blocks/denoise/jobs/${secondJob.id}`,
        {
          method: "DELETE",
          headers,
          body: JSON.stringify({ revision: beforeDelete - 1 }),
        },
      );
      assert.equal(response.status, 409);
      response = await fetch(
        `${base}/api/blocks/denoise/jobs/${secondJob.id}`,
        {
          method: "DELETE",
          headers,
          body: JSON.stringify({ revision: beforeDelete }),
        },
      );
      assert.equal(response.status, 200);
      graph = await response.json();
      await assert.rejects(
        cli(
          "complete-job",
          secondJob.id,
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
          "--note",
          "Done",
        ),
        /not found/,
      );
      await assert.rejects(
        cli(
          "complete-job",
          firstJob.id,
          "--block",
          "denoise",
          "--revision",
          String(beforeDelete),
          "--note",
          "Done",
        ),
      );
      await assert.rejects(
        cli(
          "complete-job",
          firstJob.id,
          "--block",
          "denoise",
          "--revision",
          String(graph.revision),
        ),
      );
      graph = await cli(
        "complete-job",
        firstJob.id,
        "--block",
        "denoise",
        "--revision",
        String(graph.revision),
        "--note",
        "Threshold implemented and tested",
      );
      assert.equal((await cli("jobs")).jobs.length, 0);
      assert.equal((await cli("jobs", "--all")).jobs[0].status, "done");
      assert.equal(
        graph.blocks
          .find((b) => b.id === "denoise")
          .userRequests.find((r) => r.id === requestId).jobIds.length,
        2,
      );
      graph = await cli(
        "reopen-job",
        firstJob.id,
        "--block",
        "denoise",
        "--revision",
        String(graph.revision),
        "--note",
        "Additional checks needed",
      );
      assert.equal((await cli("jobs")).jobs[0].status, "pending");
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, "project.json"))).blocks.find(
          (b) => b.id === "denoise",
        ).jobs.length,
        1,
      );
      fs.writeFileSync(htmlFile, "<h1>CLI artifact</h1>");
      const cliArtifact = await cli(
        "artifact",
        htmlFile,
        "--block",
        "denoise",
        "--revision",
        String(graph.revision),
      );
      assert.equal(cliArtifact.kind, "html");
      await assert.rejects(
        promisify(execFile)(process.execPath, [cliFile, "project"], {
          cwd: path.resolve("."),
          env: cliEnv,
          windowsHide: true,
        }),
        /workspace/,
      );
      await assert.rejects(
        promisify(execFile)(process.execPath, [cliFile, "project"], {
          cwd: path.join(testRoot, ".agents"),
          env: { ...cliEnv, ISP_API_URL: "https://example.com" },
          windowsHide: true,
        }),
        /loopback/,
      );
      const registered = await fetch(`${base}/api/artifacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Test HTML",
          blockId: "denoise",
          revision: 1,
          kind: "html",
          content: Buffer.from("<h1>Result</h1>").toString("base64"),
        }),
      });
      assert.equal(registered.status, 201);
      const artifact = await registered.json();
      assert.equal(
        (await fetch(`${base}/artifacts/${artifact.file}`)).status,
        401,
      );
      const rendered = await fetch(`${base}/artifacts/${artifact.file}`, {
        headers,
      });
      assert.equal(rendered.status, 200);
      assert.match(
        rendered.headers.get("content-security-policy"),
        /sandbox allow-scripts/,
      );
      assert.match(
        rendered.headers.get("content-security-policy"),
        /connect-src 'none'/,
      );
      assert.equal(await rendered.text(), "<h1>Result</h1>");
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
        origin: base,
      });
      await once(ws, "open");
      const presented = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.off("message", handler);
          reject(new Error("Presentation event missing"));
        }, 5000);
        function handler(data) {
          const event = JSON.parse(data);
          if (event.type === "present") {
            clearTimeout(timeout);
            ws.off("message", handler);
            resolve(event);
          }
        }
        ws.on("message", handler);
      });
      const presentation = await cli(
        "present",
        "--blocks",
        "denoise",
        "--message",
        "Updated block",
      );
      assert.equal(presentation.delivered, 1);
      const event = await presented;
      assert.deepEqual(event.presentation.blockIds, ["denoise"]);
      assert.equal(event.state.revision, graph.revision);
      const edgePresentation = await cli("present", "--edges", "mask-denoise");
      assert.deepEqual(edgePresentation.presentation.edgeIds, ["mask-denoise"]);
      assert.deepEqual(edgePresentation.presentation.blockIds, [
        "flat-detection",
        "denoise",
      ]);
      await assert.rejects(cli("present", "--edges", "missing-edge"), /간선/);
      await assert.rejects(
        cli("present", "--edges", "mask-denoise", "--artifact", cliArtifact.id),
        /함께/,
      );
      const visual = await cli("present", "--artifact", cliArtifact.id);
      assert.equal(visual.presentation.artifactId, cliArtifact.id);
      await assert.rejects(
        cli("present", "--artifact", "missing-artifact"),
        /결과물/,
      );
      await assert.rejects(cli("present", "--blocks", "deleted-block"), /블록/);
      const output = await new Promise((resolve, reject) => {
        let buffer = "";
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                `PTY context query timed out: ${JSON.stringify(buffer.slice(-3000))}`,
              ),
            ),
          30000,
        );
        ws.on("message", (data) => {
          const message = JSON.parse(data);
          if (message.type === "started") {
            ws.send(JSON.stringify({ type: "resize", cols: 110, rows: 30 }));
            const command =
              process.platform === "win32"
                ? 'node "%ISP_CLI%" context\r'
                : 'node "$ISP_CLI" context\n';
            ws.send(JSON.stringify({ type: "input", data: command }));
          }
          if (message.type === "output") {
            buffer += message.data;
            if (message.data.includes("\x1b[6n"))
              ws.send(JSON.stringify({ type: "input", data: "\x1b[1;1R" }));
            if (
              buffer.includes("flat-detection") &&
              buffer.includes("neighbors")
            ) {
              clearTimeout(timeout);
              resolve(buffer);
            }
          }
          if (message.type === "error") {
            clearTimeout(timeout);
            reject(new Error(message.error));
          }
        });
        ws.send(
          JSON.stringify({
            type: "start",
            sessionId: "ed553ea6-6c92-4791-8370-56b96657303e",
            agent: "shell",
            blockId: "flat-detection",
          }),
        );
      });
      assert.match(output, /flat-detection/);
      ws.send(JSON.stringify({ type: "stop" }));
      const folderA = path.join(testRoot, "작업 A"),
        folderB = path.join(testRoot, "작업 B");
      fs.mkdirSync(folderA);
      fs.mkdirSync(folderB);
      fs.writeFileSync(
        path.join(folderA, "AGENTS.md"),
        "Existing instructions\n",
      );
      const browse = await fetch(
        `${base}/api/folders?path=${encodeURIComponent(testRoot)}`,
        { headers },
      );
      assert.equal(browse.status, 200);
      assert.ok(
        (await browse.json()).directories.some((d) => d.name === "작업 A"),
      );
      const beforeSwitch = await (
        await fetch(`${base}/api/project`, { headers })
      ).json();
      assert.equal(
        (
          await fetch(`${base}/api/workspace`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              path: path.join(testRoot, "missing"),
              stopTerminals: true,
            }),
          })
        ).status,
        400,
      );
      assert.equal(
        (await (await fetch(`${base}/api/project`, { headers })).json())
          .revision,
        beforeSwitch.revision,
      );
      const switchResult = await fetch(`${base}/api/workspace`, {
        method: "POST",
        headers,
        body: JSON.stringify({ path: folderA, stopTerminals: true }),
      });
      assert.equal(switchResult.status, 200);
      assert.equal(
        (await fetch(`${base}/api/project`, { headers })).status,
        401,
      );
      const bootA = await (await fetch(`${base}/api/bootstrap`)).json();
      assert.equal(bootA.workspace, fs.realpathSync(folderA));
      assert.equal(bootA.state.blocks.length, 1);
      assert.equal(bootA.state.artifacts.length, 0);
      const headersA = { ...headers, Authorization: `Bearer ${bootA.token}` };
      const localCli = path.join(folderA, ".isp/tools/isp.mjs");
      const localResult = await promisify(execFile)(
        process.execPath,
        [localCli, "project"],
        {
          cwd: folderA,
          env: {
            ...process.env,
            ISP_API_URL: base,
            ISP_API_TOKEN: bootA.token,
          },
          windowsHide: true,
        },
      );
      assert.equal(JSON.parse(localResult.stdout).name, "작업 A");
      assert.match(
        fs.readFileSync(path.join(folderA, "AGENTS.md"), "utf8"),
        /^Existing instructions/,
      );
      assert.match(
        fs.readFileSync(path.join(folderA, ".gitignore"), "utf8"),
        /\.isp\//,
      );
      const changed = { ...bootA.state, name: "Saved A" };
      assert.equal(
        (
          await fetch(`${base}/api/project`, {
            method: "PUT",
            headers: headersA,
            body: JSON.stringify(changed),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${base}/api/workspace`, {
            method: "POST",
            headers: headersA,
            body: JSON.stringify({ path: folderB, stopTerminals: true }),
          })
        ).status,
        200,
      );
      const bootB = await (await fetch(`${base}/api/bootstrap`)).json();
      assert.equal(bootB.state.name, "작업 B");
      assert.equal(
        (
          await fetch(`${base}/api/workspace`, {
            method: "POST",
            headers: { ...headers, Authorization: `Bearer ${bootB.token}` },
            body: JSON.stringify({ path: folderA, stopTerminals: true }),
          })
        ).status,
        200,
      );
      assert.equal(
        (await (await fetch(`${base}/api/bootstrap`)).json()).state.name,
        "Saved A",
      );
      const health = await (await fetch(`${base}/health`)).json();
      assert.equal(health.app, "ISPBlockMaker");
      const latest = await (await fetch(`${base}/api/bootstrap`)).json();
      const finalHeaders = {...headers, Authorization: `Bearer ${latest.token}`};
      assert.equal((await fetch(`${base}/api/shutdown`, {method:"POST",headers,body:JSON.stringify({instance:health.instance})})).status,401);
      assert.equal((await fetch(`${base}/api/shutdown`, {method:"POST",headers:finalHeaders,body:JSON.stringify({instance:"stale"})})).status,409);
      const requested = await (await fetch(`${base}/api/documents/request`, {method:"POST",headers:finalHeaders,body:"{}"})).json();
      assert.ok(requested.globalWork.userRequests.some(r => r.text.includes("sdd.md")));
      const repeated = await (await fetch(`${base}/api/documents/request`, {method:"POST",headers:finalHeaders,body:"{}"})).json();
      assert.equal(repeated.revision,requested.revision);
      const html = path.join(folderA,"sdd.html");
      fs.writeFileSync(html,'<!doctype html><html><body><h1>Overview</h1><h2>Flow</h2><h2>Blocks</h2></body></html>');
      const sddRegistered = await promisify(execFile)(process.execPath,[path.join(folderA,".isp/tools/isp.mjs"),"document",html,"--revision",String(requested.revision)],{cwd:folderA,env:{...process.env,ISP_API_URL:base,ISP_API_TOKEN:latest.token}});
      const document = JSON.parse(sddRegistered.stdout);
      assert.equal(document.metadata.documentType,"sdd");
      assert.equal(document.revision,requested.revision);
      assert.match(await (await fetch(`${base}/artifacts/${document.file}`,{headers:finalHeaders})).text(),/Overview/);
      assert.equal((await fetch(`${base}/api/shutdown`,{method:"POST",headers:finalHeaders,body:JSON.stringify({instance:health.instance})})).status,200);
      await exited;
    } finally {
      ws?.terminate();
      child.kill();
      await exited;
      const checked = path.resolve(testRoot);
      assert.ok(
        checked.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
          path.basename(checked).startsWith("isp-api-test-"),
      );
      fs.rmSync(checked, { recursive: true, force: true });
    }
  },
);
