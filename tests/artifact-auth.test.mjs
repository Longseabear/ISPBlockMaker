import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startServer(t, temp, name) {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const workspace = path.join(temp, name);
  fs.mkdirSync(workspace);
  const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ISP_WORKSPACE: workspace,
      ISP_STATE_HOME: path.join(temp, "state"),
      ISP_NO_DISCOVERY: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Server did not start: ${diagnostics}`)), 15000);
    const onData = chunk => {
      diagnostics += chunk;
      if (diagnostics.includes(`http://127.0.0.1:${port}`)) finish();
    };
    const onExit = code => finish(new Error(`Server exited (${code}): ${diagnostics}`));
    const onError = error => finish(error);
    function finish(error) {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      error ? reject(error) : resolve();
    }
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
  return { origin: `http://127.0.0.1:${port}`, port };
}

test("visualization cookies stay valid when another workspace server bootstraps on the same host", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "isp-artifact-auth-"));
  // Register cleanup last so both server processes have released workspace files.
  try {
    const first = await startServer(t, temp, "first");
    const second = await startServer(t, temp, "second");
    assert.notEqual(first.port, second.port);

    // Browser cookies are scoped to host and path, not TCP port. Both fixtures
    // use 127.0.0.1 and /artifacts, so a shared cookie name would overwrite one.
    const jar = new Map();
    const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    async function bootstrap(server) {
      const response = await fetch(`${server.origin}/api/bootstrap`);
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie");
      assert.match(cookie, /;\s*Path=\/artifacts(?:;|$)/i);
      assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
      assert.match(cookie, /;\s*SameSite=Strict(?:;|$)/i);
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      jar.set(pair.slice(0, equals), pair.slice(equals + 1));
      Object.assign(server, await response.json(), { cookie: pair });
    }
    async function addArtifact(server, title) {
      server.html = `<!doctype html><title>${title}</title><p>${title}</p>`;
      const response = await fetch(`${server.origin}/api/artifacts`, {
        method: "POST",
        headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          title, blockId: server.state.blocks[0].id, revision: server.state.revision,
          kind: "html", content: Buffer.from(server.html).toString("base64"),
        }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      server.url = `${server.origin}/artifacts/${(await response.json()).file}`;
    }
    async function assertVisible(server, headers) {
      const response = await fetch(server.url, { headers });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), server.html);
      assert.match(response.headers.get("content-type"), /^text\/html\b/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const policy = response.headers.get("content-security-policy");
      assert.match(policy, /(?:^|;\s*)sandbox allow-scripts(?:;|$)/);
      assert.doesNotMatch(policy, /allow-same-origin/);
      assert.match(policy, /connect-src 'none'/);
    }

    await bootstrap(first);
    await addArtifact(first, "First workspace report");
    await bootstrap(second);
    await addArtifact(second, "Second workspace report");
    for (const current of [first, second, first]) {
      await bootstrap(current);
      for (const server of [first, second]) await assertVisible(server, { cookie: cookieHeader() });
    }

    for (const [server, other] of [[first, second], [second, first]]) {
      const ownName = server.cookie.split("=", 1)[0];
      for (const headers of [
        {},
        { cookie: `${ownName}=invalid` },
        { cookie: other.cookie },
        { cookie: `${ownName}=${other.token}` },
        { cookie: `isp_session=${server.token}` },
      ]) {
        const response = await fetch(server.url, { headers });
        assert.equal(response.status, 401);
        await response.text();
      }
      await assertVisible(server, { authorization: `Bearer ${server.token}` });
    }
  } finally {
    t.after(() => {
      assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
      fs.rmSync(temp, { recursive: true, force: true });
    });
  }
});
