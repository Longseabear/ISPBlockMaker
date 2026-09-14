import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initialProject,
  validateGraph,
  contextFor,
  toMermaid,
} from "../server/model.mjs";
import { createStore } from "../server/store.mjs";

test("Git graph and local work migrate separately; checkout preserves work and rejects stale writes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-split-test-"));
  try {
    const legacy = structuredClone(initialProject);
    legacy.blocks[0].userRequests = [
      {
        id: "memo",
        text: "Keep me",
        status: "pending",
        createdAt: new Date().toISOString(),
        resolution: "",
      },
    ];
    legacy.artifacts = [
      { id: "result", blockId: "input", title: "Historical result" },
    ];
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(legacy));
    const store = createStore(dir);
    const graphPath = path.join(dir, "graph.json");
    const originalText = fs.readFileSync(graphPath, "utf8");
    const spec = JSON.parse(originalText);
    assert.ok(!("revision" in spec) && !("artifacts" in spec));
    assert.ok(
      !("userRequests" in spec.blocks[0]) && !("jobs" in spec.blocks[0]),
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, "project.legacy.json"))),
      legacy,
    );
    let current = structuredClone(store.get());
    current.blocks[0].userRequests[0].text = "Updated local memo";
    store.graph(current, current.revision);
    store.select("denoise");
    store.artifact({ id: "second", blockId: "input" });
    assert.equal(fs.readFileSync(graphPath, "utf8"), originalText);
    const stale = structuredClone(store.get());
    const removed = {
      ...spec,
      blocks: spec.blocks.filter((b) => b.id !== "input"),
      edges: spec.edges.filter((e) => e.source !== "input"),
    };
    fs.writeFileSync(graphPath, JSON.stringify(removed));
    assert.throws(
      () => store.graph(stale, stale.revision),
      (e) => e.status === 409,
    );
    assert.equal(store.get().blocks.length, 2);
    fs.writeFileSync(graphPath, originalText);
    const restored = createStore(dir).get();
    assert.equal(restored.blocks[0].userRequests[0].text, "Updated local memo");
    assert.equal(restored.artifacts.length, 2);
    const local = JSON.parse(fs.readFileSync(path.join(dir, "project.json")));
    assert.ok(!("name" in local) && !("edges" in local));
    assert.ok(!("principle" in local.blocks[0]));
    fs.writeFileSync(graphPath, "invalid JSON");
    assert.throws(() => store.get());
    assert.equal(fs.readFileSync(graphPath, "utf8"), "invalid JSON");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("graph rejects cycles, mismatched types and competing input connections", () => {
  const cycle = structuredClone(initialProject);
  cycle.blocks[0].inputs = [{ id: "image", name: "Image", type: "image" }];
  cycle.edges.push({
    id: "cycle",
    source: "denoise",
    sourceHandle: "image",
    target: "input",
    targetHandle: "image",
  });
  assert.throws(() => validateGraph(cycle), /순환/);
  const mismatch = structuredClone(initialProject);
  mismatch.edges[2].targetHandle = "image";
  assert.throws(() => validateGraph(mismatch), /유형/);
  const duplicate = structuredClone(initialProject);
  duplicate.edges.push({ ...duplicate.edges[0], id: "duplicate" });
  assert.throws(() => validateGraph(duplicate), /하나의 출력/);
});

test("stale agent writes cannot overwrite newer edits; state survives reopening", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-store-test-"));
  try {
    const store = createStore(dir),
      original = structuredClone(store.get());
    store.graph({ ...original, name: "Edited in UI" }, original.revision);
    assert.throws(
      () =>
        store.graph(
          { ...original, name: "Old agent state" },
          original.revision,
        ),
      (e) => e.status === 409,
    );
    assert.equal(createStore(dir).get().name, "Edited in UI");
    assert.equal(createStore(dir).get().revision, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("block context includes side inputs and neighbors, Mermaid preserves port labels", () => {
  const context = contextFor(initialProject, "denoise");
  assert.deepEqual(
    context.neighbors.map((b) => b.id),
    ["input", "flat-detection"],
  );
  assert.equal(context.connections.length, 2);
  assert.match(toMermaid(initialProject), /mask → mask/);
});


test("legacy blocks gain agent contracts without losing descriptions and contracts persist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-contract-test-"));
  try {
    fs.writeFileSync(
      path.join(dir, "project.json"),
      JSON.stringify(initialProject),
    );
    const store = createStore(dir);
    const graph = structuredClone(store.get());
    const block = graph.blocks.find((b) => b.id === "flat-detection");
    assert.equal(block.agentContract.validation, "");
    assert.equal(block.agentContract.inputs, "");
    assert.equal(block.agentContract.outputs, "");
    assert.equal(block.agentContract.notes, "");
    block.agentContract.inputs = "image: normalized grayscale, H x W. Example: constant 0.5.";
    block.agentContract.outputs = "mask: 1 means flat; shape matches image.";
    block.agentContract.notes = "Design notes\nKeep strict threshold comparison; equality is not flat.";
    assert.equal(block.detail, "");
    const originalSummary = block.description;
    block.detail = "사용자 상세: 입력 예와 파라미터 해석.\n두 번째 문단.";
    block.agentContract.validation = "node ../scripts/isp.mjs demo";
    store.graph(graph, graph.revision);
    const context = contextFor(createStore(dir).get(), block.id);
    assert.equal(context.human.summary, block.description);
    assert.equal(context.human.summary, originalSummary);
    assert.equal(context.human.detail, block.detail);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"graph.json"),"utf8")).blocks.find(b=>b.id===block.id).detail,block.detail);
    assert.equal(
      context.agent.contract.validation,
      block.agentContract.validation,
    );
    assert.deepEqual(context.agent.shared.inputs, block.inputs);
    assert.equal(context.agent.contract.inputs, block.agentContract.inputs);
    assert.equal(context.agent.contract.outputs, block.agentContract.outputs);
    assert.equal(context.agent.contract.notes, block.agentContract.notes);
    assert.equal(context.agent.algorithm, block.principle);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
