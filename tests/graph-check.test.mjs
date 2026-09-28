import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { graphCheck } from "../server/graph-check.mjs";

const port = (id = "image", type = "image") => ({ id, name: id, type });
const block = (id, implementation = "shared.py", implementationSymbol = id) => ({
  id, name: id, description: "Processes an image.", detail: "", principle: "Example transformation.",
  implementation, implementationSymbol, status: "implemented",
  inputs: [port()], outputs: [port()], parameters: {}, position: { x: 0, y: 0 },
  agentContract: { inputs: "image: input array", outputs: "image: transformed array" },
});
const graph = (blocks = [block("first"), block("second")]) => ({
  name: "Check fixture", revision: 42, overview: { entryPoint: "shared.py:first" }, blocks,
  edges: blocks.length > 1 ? [{ id: "first-second", source: blocks[0].id, sourceHandle: "image", target: blocks[1].id, targetHandle: "image" }] : [],
});
const finding = (report, code, id) => report.findings.find((item) => item.code === code && (id === undefined || item.blockId === id));

async function fixture(t, migrated = false) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "isp-graph-check-"));
  t.after(async () => {
    assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const source = migrated ? path.join(workspace, "project") : workspace;
  if (migrated) {
    await fs.mkdir(source);
    await fs.mkdir(path.join(workspace, ".isp"));
    await fs.writeFile(path.join(workspace, ".isp", "workspace.json"), JSON.stringify({ version: 1, sourceRoot: "project" }));
  }
  await fs.writeFile(path.join(source, "shared.py"), "def first(image):\n    return image\n\ndef second(image):\n    return image\n");
  return { workspace, source };
}

test("checks actual source and explicit symbols, reusing shared-file reads without mutating graph or files", async (t) => {
  const { workspace, source } = await fixture(t);
  const project = graph();
  await fs.writeFile(path.join(source, "graph.json"), JSON.stringify(project));
  await fs.mkdir(path.join(source, ".git"));
  await fs.writeFile(path.join(source, ".git", "index"), "unchanged index");
  const before = structuredClone(project);
  const graphBefore = await fs.readFile(path.join(source, "graph.json"));
  const sourceBefore = await fs.readFile(path.join(source, "shared.py"));
  const filesBefore = await fs.readdir(source, { recursive: true });
  const report = await graphCheck(workspace, project);
  assert.equal(report.ok, true);
  assert.equal(report.summary.error, 0);
  assert.equal(report.summary.warning, 0);
  assert.equal(report.summary.filesChecked, 1);
  assert.equal(report.summary.filesRead, 1);
  assert.equal(report.summary.bytesRead, sourceBefore.length);
  assert.equal(finding(report, "implementation.symbol_found", "second").line, 4);
  const evidence = finding(report, "implementation.symbol_found", "second").sourceEvidence;
  assert.equal(evidence.sha256, createHash("sha256").update(sourceBefore).digest("hex"));
  assert.equal(evidence.sizeBytes, sourceBefore.length);
  assert.equal(evidence.modifiedAt, (await fs.stat(path.join(source, "shared.py"))).mtime.toISOString());
  assert.equal(finding(report, "edge.ports_match").edgeId, "first-second");
  assert.deepEqual(report.impact.sharedFiles, [{ path: "shared.py", blockIds: ["first", "second"] }]);
  assert.deepEqual(project, before);
  assert.deepEqual(await fs.readFile(path.join(source, "graph.json")), graphBefore);
  assert.deepEqual(await fs.readFile(path.join(source, "shared.py")), sourceBefore);
  assert.equal(await fs.readFile(path.join(source, ".git", "index"), "utf8"), "unchanged index");
  assert.deepEqual(await fs.readdir(source, { recursive: true }), filesBefore);
  assert.ok(report.limitations.some((text) => text.includes("semantic agreement")));
});

test("reports missing implementation paths and uncertain explicit symbols separately", async (t) => {
  const { workspace, source } = await fixture(t);
  await fs.writeFile(path.join(source, "decoys.py"), '# def absent(image):\n"""\ndef absent(image):\n"""\n');
  const project = graph([block("first", "missing.py", "first"), block("second", "decoys.py", "absent")]);
  const report = await graphCheck(workspace, project);
  assert.equal(report.ok, false);
  assert.equal(finding(report, "implementation.missing", "first").severity, "error");
  assert.equal(finding(report, "implementation.symbol_unresolved", "second").severity, "warning");
  assert.match(finding(report, "implementation.symbol_unresolved").reason, /absent, ambiguous or use unsupported syntax/);
  await fs.writeFile(path.join(source, "decoys.py"), "class One:\n    def process(self): pass\nclass Two:\n    def process(self): pass\n");
  const ambiguous = await graphCheck(workspace, graph([block("first", "decoys.py", "process")]));
  assert.equal(ambiguous.ok, true);
  assert.ok(finding(ambiguous, "implementation.symbol_unresolved"));
  const qualified = await graphCheck(workspace, graph([block("first", "decoys.py", "One.process")]));
  assert.ok(finding(qualified, "implementation.symbol_found"));
});

test("unsupported C++ and unknown language declarations require review, never missing-symbol errors", async (t) => {
  const { workspace, source } = await fixture(t);
  await fs.writeFile(path.join(source, "filter.cpp"), "void process() {}\n");
  await fs.writeFile(path.join(source, "filter.rs"), "fn process() {}\n");
  const report = await graphCheck(workspace, graph([block("first", "filter.cpp", "process"), block("second", "filter.rs", "process")]));
  assert.equal(report.ok, true);
  assert.equal(report.summary.error, 0);
  assert.equal(report.summary.warning, 0);
  assert.equal(report.summary.filesRead, 0);
  assert.equal(report.findings.filter((item) => item.code === "implementation.symbol_review").length, 2);
  assert.equal(report.findings.some((item) => item.code === "implementation.symbol_unresolved"), false);
});

test("missing optional metadata gives focused suggestions without requiring every contract field", async (t) => {
  const { workspace } = await fixture(t);
  const project = graph([block("first")]);
  project.overview = {};
  project.blocks[0].description = "";
  project.blocks[0].implementationSymbol = "";
  project.blocks[0].agentContract = {};
  const report = await graphCheck(workspace, project);
  assert.equal(report.ok, true);
  assert.equal(report.summary.warning, 0);
  for (const code of ["metadata.entry_point_unspecified", "metadata.human_description_unspecified", "metadata.agent_inputs_unspecified", "metadata.agent_outputs_unspecified", "metadata.symbol_unspecified"]) assert.equal(finding(report, code).severity, "info");
  assert.equal(report.findings.some((item) => /acceptance|validation|numerics|boundaries|dataFormat|steps/.test(item.code)), false);
  project.blocks[0].inputs = [];
  project.blocks[0].outputs = [];
  const terminal = await graphCheck(workspace, project);
  assert.equal(finding(terminal, "metadata.agent_inputs_unspecified"), undefined);
  assert.equal(finding(terminal, "metadata.agent_outputs_unspecified"), undefined);
});

test("block-scoped changed-file impact includes every shared block, relocated paths and deleted paths", async (t) => {
  const { workspace, source } = await fixture(t, true);
  const project = graph([block("first", path.join(workspace, "shared.py")), block("second", path.join(source, "shared.py")), block("third", "deleted.py", "third")]);
  const report = await graphCheck(workspace, project, { blockId: "first", changedFiles: ["./shared.py", "shared.py", "deleted.py", "unmapped.txt"] });
  assert.deepEqual(report.scope.blockIds, ["first"]);
  assert.equal(report.summary.filesRead, 1);
  assert.deepEqual(report.impact.blockIds, ["first", "second", "third"]);
  assert.deepEqual(report.impact.changedFiles[0], { path: "shared.py", blockIds: ["first", "second"], shared: true });
  assert.equal(report.impact.changedFiles.length, 3);
  assert.equal(finding(report, "implementation.missing", "third"), undefined);
  assert.ok(finding(report, "impact.unmapped_file"));
  await fs.mkdir(path.join(source, "project"));
  await fs.writeFile(path.join(source, "project", "shared.py"), "def first(image): return image\n");
  const nested = await graphCheck(workspace, graph([block("first", "project/shared.py")]), { changedFiles: ["project/shared.py", "shared.py"] });
  assert.deepEqual(nested.impact.changedFiles.map((item) => item.blockIds), [["first"], []]);
});

test("rejects implementation and changed-file paths outside the source including junction escapes", async (t) => {
  const { workspace, source } = await fixture(t, true);
  await fs.writeFile(path.join(workspace, "outside.py"), "def first(): pass\n");
  const report = await graphCheck(workspace, graph([block("first", "../outside.py")]), { changedFiles: ["../outside.py", path.join(source, "shared.py"), "C:\\outside.py"] });
  assert.equal(finding(report, "implementation.outside").severity, "error");
  assert.equal(report.impact.changedFiles.length, 0);
  assert.equal(report.summary.filesRead, 0);
  await fs.mkdir(path.join(workspace, "project-sibling"));
  await fs.writeFile(path.join(workspace, "project-sibling", "filter.py"), "def first(): pass\n");
  const sibling = await graphCheck(workspace, graph([block("first", "../project-sibling/filter.py")]));
  assert.ok(finding(sibling, "implementation.outside"));
  try { await fs.symlink(path.join(workspace, "project-sibling"), path.join(source, "linked"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return; throw error; }
  const linked = await graphCheck(workspace, graph([block("first", "linked/filter.py")]), { changedFiles: ["linked/filter.py"] });
  assert.ok(finding(linked, "implementation.outside"));
  assert.ok(finding(linked, "impact.path_outside_source"));
  assert.equal(linked.summary.filesRead, 0);
});

test("read limits and binary data require manual review; source is never executed", async (t) => {
  const { workspace, source } = await fixture(t);
  await fs.writeFile(path.join(source, "large.py"), "#".repeat(2 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(source, "binary.py"), "\0def first(): pass");
  await fs.writeFile(path.join(source, "execute.mjs"), 'throw new Error("MUST NOT EXECUTE");\nexport function third() {}\n');
  const report = await graphCheck(workspace, graph([block("first", "large.py"), block("second", "binary.py"), block("third", "execute.mjs")]));
  assert.ok(finding(report, "implementation.read_limit", "first"));
  assert.ok(finding(report, "implementation.binary", "second"));
  assert.ok(finding(report, "implementation.symbol_found", "third"));
  assert.equal(report.summary.filesRead, 2);
  assert.ok(report.summary.bytesRead < 1024);
  assert.equal(report.ok, true);
});

test("structured connection errors retain edge IDs and remain checked with a block filter", async (t) => {
  const { workspace } = await fixture(t);
  const project = graph();
  project.blocks[1].inputs[0].type = "mask";
  project.edges.push({ id: "missing-port", source: "first", sourceHandle: "absent", target: "second", targetHandle: "image" });
  project.edges.push({ id: "missing-block", source: "absent", sourceHandle: "image", target: "second", targetHandle: "image" });
  const report = await graphCheck(workspace, project, { blockId: "first" });
  assert.equal(report.ok, false);
  assert.equal(finding(report, "edge.type_mismatch").edgeId, "first-second");
  assert.equal(finding(report, "edge.port_missing").edgeId, "missing-port");
  assert.equal(finding(report, "edge.block_missing").edgeId, "missing-block");
  assert.equal(finding(report, "edge.input_conflict").severity, "error");
  const cycle = graph();
  cycle.edges.push({ id: "cycle", source: "second", sourceHandle: "image", target: "first", targetHandle: "image" });
  assert.ok(finding(await graphCheck(workspace, cycle), "graph.structure_invalid"));
  const badSchema = graph();
  badSchema.edges[0].sourceHandle = "";
  const invalid = await graphCheck(workspace, badSchema);
  assert.equal(finding(invalid, "graph.schema_invalid").edgeId, "first-second");
  assert.equal(invalid.summary.filesRead, 0);
});

test("limits total source bytes and file count while keeping skipped work explicit", async (t) => {
  const { workspace, source } = await fixture(t);
  const size = 2 * 1024 * 1024;
  const content = "#" + "x".repeat(size - 2) + "\n";
  const blocks = [];
  for (let index = 0; index < 9; index++) {
    const file = `large-${index}.py`;
    await fs.writeFile(path.join(source, file), content);
    blocks.push(block(`block-${index}`, file, ""));
  }
  const bytesLimited = await graphCheck(workspace, graph(blocks));
  assert.equal(bytesLimited.summary.bytesRead, 16 * 1024 * 1024);
  assert.equal(bytesLimited.summary.filesRead, 8);
  assert.ok(finding(bytesLimited, "implementation.read_limit", "block-8"));
  const small = [];
  for (let index = 0; index < 101; index++) {
    const file = `small-${index}.py`;
    await fs.writeFile(path.join(source, file), "# small\n");
    small.push(block(`block-${index}`, file, ""));
  }
  const filesLimited = await graphCheck(workspace, graph(small));
  assert.equal(filesLimited.summary.filesRead, 100);
  assert.ok(finding(filesLimited, "implementation.read_limit", "block-100"));
});

test("reports unknown selected blocks and malformed changed-file options without throwing", async (t) => {
  const { workspace } = await fixture(t);
  assert.equal(finding(await graphCheck(workspace, graph(), { blockId: "unknown" }), "block.not_found").severity, "error");
  assert.ok(finding(await graphCheck(workspace, graph(), { changedFiles: "shared.py" }), "impact.invalid_changed_files"));
});
