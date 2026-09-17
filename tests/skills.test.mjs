import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installWorkspaceSkills } from "../server/skills.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(root, "templates/project");
const slash = value => value.split(path.sep).join("/");

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "isp-skills-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("isp-skills-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function makeWorkspace(parent, name = "workspace") {
  const workspace = path.join(parent, name);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? files(path.join(directory, entry.name), relative)
      : [relative];
  });
}

function localLinks(text) {
  return [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1].split("#")[0])
    .filter(target => target && !/^[a-z][a-z\d+.-]*:/i.test(target));
}

function readManifest(workspace) {
  return JSON.parse(fs.readFileSync(path.join(workspace, ".isp/skill-manifest.json"), "utf8"));
}

function copiedFramework(parent) {
  const framework = path.join(parent, "framework");
  fs.mkdirSync(framework);
  fs.cpSync(path.join(root, "templates"), path.join(framework, "templates"), { recursive: true });
  return framework;
}

test("workspace setup supplies seven discoverable skills for both agents with valid local references", t => {
  const temp = temporary(t);
  const workspace = makeWorkspace(temp, "프로젝트 A");
  const unrelated = makeWorkspace(temp, "프로젝트 B");
  const result = installWorkspaceSkills(workspace, root);
  const names = fs.readdirSync(path.join(templateRoot, ".agents/skills"), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(names.length, 7);
  assert.ok(names.includes("isp-block-maker"));

  for (const kind of [".agents", ".claude"]) {
    const installedNames = fs.readdirSync(path.join(workspace, kind, "skills")).sort();
    assert.deepEqual(installedNames, names);
    for (const name of names) {
      const relative = `${kind}/skills/${name}/SKILL.md`;
      const file = path.join(workspace, relative);
      const text = fs.readFileSync(file, "utf8");
      assert.match(text, /^---\r?\n/);
      assert.match(text, new RegExp(`^name: ${name}\\r?$`, "m"));
      assert.match(text, /^description: \S.+$/m);
      assert.ok(result.installed.map(slash).includes(relative), relative);
      if (kind === ".claude") {
        const destinations = localLinks(text).map(target => path.resolve(path.dirname(file), target));
        assert.ok(destinations.includes(path.join(workspace, ".agents/skills", name, "SKILL.md")), name);
      }
    }
  }

  for (const relative of files(path.join(workspace, ".agents/skills"))) {
    if (!relative.endsWith(".md")) continue;
    const file = path.join(workspace, ".agents/skills", relative);
    for (const target of localLinks(fs.readFileSync(file, "utf8"))) {
      const destination = path.resolve(path.dirname(file), target);
      const fromWorkspace = path.relative(workspace, destination);
      assert.ok(!fromWorkspace.startsWith(`..${path.sep}`) && fromWorkspace !== ".." && !path.isAbsolute(fromWorkspace), `${relative}: ${target}`);
      assert.ok(fs.existsSync(destination), `${relative}: missing ${target}`);
      assert.ok(fs.readFileSync(destination, "utf8").trim(), `${relative}: empty ${target}`);
    }
  }

  const manifest = readManifest(workspace);
  assert.equal(manifest.version, 1);
  for (const relative of result.installed) {
    assert.match(manifest.files[slash(relative)], /^[a-f\d]{64}$/);
  }
  assert.deepEqual(fs.readdirSync(unrelated), []);
  assert.equal(fs.existsSync(path.join(temp, ".agents")), false);
  assert.equal(fs.existsSync(path.join(temp, ".claude")), false);
  assert.equal(fs.existsSync(path.join(workspace, "graph.json")), false);
});

test("repeated installation is stable and retains workspace edits", t => {
  const workspace = makeWorkspace(temporary(t));
  installWorkspaceSkills(workspace, root);
  const manifestBefore = fs.readFileSync(path.join(workspace, ".isp/skill-manifest.json"), "utf8");
  const second = installWorkspaceSkills(workspace, root);
  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.updated, []);
  assert.equal(fs.readFileSync(path.join(workspace, ".isp/skill-manifest.json"), "utf8"), manifestBefore);

  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  const file = path.join(workspace, relative);
  fs.appendFileSync(file, "\nCustom workspace rule: retain calibrated input values.\n");
  const custom = fs.readFileSync(file);
  const result = installWorkspaceSkills(workspace, root);
  assert.deepEqual(fs.readFileSync(file), custom);
  assert.ok(result.preserved.map(slash).includes(relative));
  installWorkspaceSkills(workspace, root);
  assert.deepEqual(fs.readFileSync(file), custom);
});

test("template updates replace unchanged managed files and preserve internal edits with an update candidate", t => {
  const temp = temporary(t);
  const framework = copiedFramework(temp);
  const workspace = makeWorkspace(temp);
  const projectTemplates = path.join(framework, "templates/project");
  const documents = files(path.join(projectTemplates, ".agents/skills"))
    .filter(relative => relative.endsWith(".md") && path.basename(relative) !== "SKILL.md");
  assert.ok(documents.length >= 2, "Need two independently managed supporting documents");
  const unchanged = slash(path.join(".agents/skills", documents[0]));
  const customized = slash(path.join(".agents/skills", documents[1]));
  installWorkspaceSkills(workspace, framework);

  const customizedFile = path.join(workspace, customized);
  const before = fs.readFileSync(customizedFile, "utf8");
  const lines = before.split("\n");
  lines.splice(Math.max(1, Math.floor(lines.length / 2)), 0, "Project constraint: operate on calibrated sensor samples.");
  fs.writeFileSync(customizedFile, lines.join("\n"));
  const localContent = fs.readFileSync(customizedFile);
  for (const relative of [unchanged, customized]) {
    fs.appendFileSync(path.join(projectTemplates, relative), "\nUpstream guidance update for this test.\n");
  }

  const result = installWorkspaceSkills(workspace, framework);
  assert.ok(result.updated.map(slash).includes(unchanged));
  assert.deepEqual(fs.readFileSync(path.join(workspace, unchanged)), fs.readFileSync(path.join(projectTemplates, unchanged)));
  assert.ok(result.preserved.map(slash).includes(customized));
  assert.ok(result.pending.map(slash).includes(customized));
  assert.deepEqual(fs.readFileSync(customizedFile), localContent);
  assert.deepEqual(fs.readFileSync(path.join(workspace, ".isp/skill-updates", customized)), fs.readFileSync(path.join(projectTemplates, customized)));

  const repeated = installWorkspaceSkills(workspace, framework);
  assert.deepEqual(repeated.updated, []);
  assert.deepEqual(fs.readFileSync(customizedFile), localContent);
});

test("line-ending conversion alone does not prevent a managed update", t => {
  const temp = temporary(t);
  const framework = copiedFramework(temp);
  const workspace = makeWorkspace(temp);
  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  installWorkspaceSkills(workspace, framework);
  const file = path.join(workspace, relative);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
  fs.appendFileSync(path.join(framework, "templates/project", relative), "\nAdditional upstream guidance.\n");
  const result = installWorkspaceSkills(workspace, framework);
  assert.ok(result.updated.map(slash).includes(relative));
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(framework, "templates/project", relative)));
});

test("known legacy skill upgrades without retaining the monolithic entry point", t => {
  const workspace = makeWorkspace(temporary(t));
  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(root, "templates/skill-migrations/isp-block-maker-v1.md"), file);
  const result = installWorkspaceSkills(workspace, root);
  assert.ok(result.updated.map(slash).includes(relative));
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(templateRoot, relative)));
});

test("legacy section ordering and generated CLI aliases are recognized during upgrade", t => {
  const workspace = makeWorkspace(temporary(t));
  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const legacy = fs.readFileSync(path.join(root, "templates/skill-migrations/isp-block-maker-v1.md"), "utf8");
  const sections = legacy.split(/(?=^## )/m);
  assert.ok(sections.length > 2);
  const reordered = [sections[0], ...sections.slice(1).reverse()].join("\n")
    .replaceAll("../../../.isp/tools/isp.mjs", "../../../isp.mjs")
    .replaceAll('"<absolute workspace>/.isp/tools/isp.mjs"', '"<absolute workspace>/isp.mjs"')
    .replace("When asked to iterate, optimize, compare parameters, or process remaining JOBs, read `experiment-loop.md` beside this skill. This is an execution protocol for the agent, not an automatic scheduler. Do not start indefinite background runs merely because this skill is present.", "For iteration and remaining JOB requests, read `experiment-loop.md` beside this skill. Do not start an indefinite scheduler.")
    .replace("For Documentation / SDD requests", "For Document화 / SDD requests")
    .replace("Read `graph-overview.md` for graph purpose, execution entry points, important constraints and freeform agent notes. Read `isp graph-info` before pipeline work and keep affected overview fields synchronized with implementation.", "Read `graph-overview.md` and `isp graph-info` before pipeline work. Keep the graph purpose, entry points, constraints and freeform agent notes synchronized with implementation.")
    .replace(/^(## .+)\r?\n/gm, "$1\n\n\n");
  fs.writeFileSync(file, reordered);
  installWorkspaceSkills(workspace, root);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(templateRoot, relative)));
});

test("released legacy entry and older Viewer/SDD guides upgrade together", t => {
  const workspace = makeWorkspace(temporary(t));
  const skill = ".agents/skills/isp-block-maker/";
  fs.mkdirSync(path.join(workspace, skill), { recursive: true });
  const legacy = fs.readFileSync(path.join(root, "templates/skill-migrations/isp-block-maker-v1.md"), "utf8").replace(/\r\n/g, "\n");
  const start = legacy.indexOf("## Route reports and image display by user intent\n");
  const end = legacy.indexOf("\n## ", start + 1);
  assert.ok(start > 0 && end > start);
  fs.writeFileSync(path.join(workspace, skill, "SKILL.md"), (legacy.slice(0, start) + legacy.slice(end)).replace(/\n/g, "\r\n"));
  for (const name of ["viewer.md", "sdd.md"]) {
    let text = fs.readFileSync(path.join(root, "templates/skill-migrations/project", skill, name), "utf8");
    text = name === "sdd.md" ? text.replaceAll("Documentation", "Document화") : text
      .replaceAll("**크롭 묶음 전달**", "**선택한 크롭 전달**")
      .replace("Use each item’s `paths.metadata` relative to the workspace. For a single region use `paths.crop`; for grouped items use every `regions[].paths.crop` (top-level `paths.crop` is a ZIP).", "Use each item’s `paths.crop` and `paths.metadata` relative to the workspace.");
    fs.writeFileSync(path.join(workspace, skill, name), text);
  }
  const result = installWorkspaceSkills(workspace, root);
  assert.deepEqual(result.pending, []);
  for (const name of ["SKILL.md", "viewer.md", "sdd.md"]) {
    assert.ok(result.updated.includes(skill + name));
    assert.deepEqual(fs.readFileSync(path.join(workspace, skill, name)), fs.readFileSync(path.join(templateRoot, skill, name)));
  }
});

test("legacy content with a duplicate section is preserved for manual reconciliation", t => {
  const workspace = makeWorkspace(temporary(t));
  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const legacy = fs.readFileSync(path.join(root, "templates/skill-migrations/isp-block-maker-v1.md"), "utf8");
  const firstSection = legacy.split(/(?=^## )/m)[1];
  assert.ok(firstSection);
  const custom = `${legacy}\n${firstSection}\n`;
  fs.writeFileSync(file, custom);
  const result = installWorkspaceSkills(workspace, root);
  assert.deepEqual(fs.readFileSync(file, "utf8"), custom);
  assert.ok(result.preserved.map(slash).includes(relative));
  assert.ok(result.pending.map(slash).includes(relative));
});

test("unknown legacy instructions are retained byte for byte with the new skill available as a candidate", t => {
  const workspace = makeWorkspace(temporary(t));
  const relative = ".agents/skills/isp-block-maker/SKILL.md";
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const custom = Buffer.from("---\r\nname: isp-block-maker\r\ndescription: Custom workspace behavior.\r\n---\r\n\r\nRetain the user's experimental constraints.\r\n");
  fs.writeFileSync(file, custom);
  const result = installWorkspaceSkills(workspace, root);
  assert.deepEqual(fs.readFileSync(file), custom);
  assert.ok(result.preserved.map(slash).includes(relative));
  assert.ok(result.pending.map(slash).includes(relative));
  assert.deepEqual(fs.readFileSync(path.join(workspace, ".isp/skill-updates", relative)), fs.readFileSync(path.join(templateRoot, relative)));
});

test("installation rejects a workspace skill directory linked outside the workspace", t => {
  const temp = temporary(t);
  const workspace = makeWorkspace(temp);
  const outside = makeWorkspace(temp, "outside");
  const sentinel = path.join(outside, "retain.txt");
  fs.writeFileSync(sentinel, "Do not change outside workspace");
  const link = path.join(workspace, ".agents");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Directory links are not available for this test account");
    throw error;
  }
  assert.throws(() => installWorkspaceSkills(workspace, root));
  assert.deepEqual(fs.readdirSync(outside), ["retain.txt"]);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "Do not change outside workspace");
});
