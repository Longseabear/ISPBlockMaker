import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const normalize = text => text.replace(/\r\n/g, "\n");
const hash = text => crypto.createHash("sha256").update(normalize(text)).digest("hex");
const entry = ".agents/skills/isp-block-maker/SKILL.md";

// Earlier installers appended these sections, sometimes with older wording.
// Accept only those exact generated variants, never arbitrary user changes.
function legacySections(text) {
  const aliases = [
    ["../../../isp.mjs", "../../../.isp/tools/isp.mjs"],
    ['"<absolute workspace>/isp.mjs"', '"<absolute workspace>/.isp/tools/isp.mjs"'],
    ["workspace/graph.json", "graph.json"],
    ["For iteration and remaining JOB requests, read `experiment-loop.md` beside this skill. Do not start an indefinite scheduler.", "When asked to iterate, optimize, compare parameters, or process remaining JOBs, read `experiment-loop.md` beside this skill. This is an execution protocol for the agent, not an automatic scheduler. Do not start indefinite background runs merely because this skill is present."],
    ["For Document화 / SDD requests", "For Documentation / SDD requests"],
    ["Read `graph-overview.md` and `isp graph-info` before pipeline work. Keep the graph purpose, entry points, constraints and freeform agent notes synchronized with implementation.", "Read `graph-overview.md` for graph purpose, execution entry points, important constraints and freeform agent notes. Read `isp graph-info` before pipeline work and keep affected overview fields synchronized with implementation."],
  ];
  text = normalize(text);
  for (const [before, after] of aliases) text = text.replaceAll(before, after);
  const sections = text.split(/(?=^## )/m).map(section => section
    .split("\n").map(line => line.trimEnd()).filter(line => line.trim()).join("\n").trim());
  const headings = sections.slice(1).map(section => section.split("\n")[0]);
  if (new Set(headings).size !== headings.length) return null;
  return JSON.stringify(sections.sort());
}

function legacyReferenceText(relative, text) {
  if (relative === ".agents/skills/isp-block-maker/sdd.md")
    text = text.replaceAll("Document화", "Documentation");
  if (relative === ".agents/skills/isp-block-maker/viewer.md") {
    text = text.replaceAll("**선택한 크롭 전달**", "**크롭 묶음 전달**")
      .replace("Use each item’s `paths.crop` and `paths.metadata` relative to the workspace.",
        "Use each item’s `paths.metadata` relative to the workspace. For a single region use `paths.crop`; for grouped items use every `regions[].paths.crop` (top-level `paths.crop` is a ZIP).");
  }
  return text;
}

function targetPath(workspace, relative) {
  const parts = relative.split(/[\\/]/);
  if (path.isAbsolute(relative) || parts.some(part => !part || part === "." || part === ".."))
    throw new Error(`Invalid workspace skill path: ${relative}`);
  let target = workspace;
  for (const part of parts) {
    target = path.join(target, part);
    try {
      if (fs.lstatSync(target).isSymbolicLink())
        throw new Error(`Workspace skill path must not be a symlink: ${relative}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}

function writeAtomic(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return true;
}

function templateFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Skill template cannot be a symlink: ${relative}`);
    if (item.isDirectory()) return templateFiles(path.join(directory, item.name), relative);
    return item.isFile() ? [relative] : [];
  });
}

export function installWorkspaceSkills(folder, root) {
  const workspace = fs.realpathSync(folder);
  const templates = path.join(root, "templates/project");
  const files = [".agents/skills", ".claude/skills"].flatMap(prefix =>
    templateFiles(path.join(templates, prefix)).map(file => `${prefix}/${file}`));
  // Install dependencies before replacing the compatibility entry point.
  files.sort((a, b) => Number(a === entry) - Number(b === entry) || a.localeCompare(b));
  const manifestFile = targetPath(workspace, ".isp/skill-manifest.json");
  const saved = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  const previous = saved.version === 1 ? saved.files || {} : {};
  const next = { ...previous };
  const legacyFile = path.join(root, "templates/skill-migrations/isp-block-maker-v1.md");
  const legacy = new Set();
  if (fs.existsSync(legacyFile)) {
    const text = fs.readFileSync(legacyFile, "utf8");
    legacy.add(legacySections(text));
    // Released 0.1.13 predates the report/viewer routing section.
    legacy.add(legacySections(normalize(text).split(/(?=^## )/m)
      .filter(section => !section.startsWith("## Route reports and image display by user intent\n"))
      .join("")));
  }
  const result = { installed: [], updated: [], preserved: [], pending: [] };

  // Check every destination before writing anything, including update candidates.
  const plans = files.map(relative => {
    const file = targetPath(workspace, relative);
    const candidate = targetPath(workspace, `.isp/skill-updates/${relative}`);
    const template = fs.readFileSync(path.join(templates, relative), "utf8");
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const legacyReference = path.join(root, "templates/skill-migrations/project", relative);
    const reference = fs.existsSync(legacyReference) ? fs.readFileSync(legacyReference, "utf8") : template;
    const knownReference = current !== null &&
      hash(legacyReferenceText(relative, current)) === hash(reference);
    const managed = current !== null && (hash(current) === hash(template) ||
      hash(current) === previous[relative] || knownReference ||
      (relative === entry && legacySections(current) !== null && legacy.has(legacySections(current))));
    return { relative, file, candidate, template, current, managed };
  });
  for (const { relative, file, candidate, template, current, managed } of plans) {
    if (current === null || managed) {
      if (current === null) result.installed.push(relative);
      else if (hash(current) !== hash(template)) result.updated.push(relative);
      if (current === null || hash(current) !== hash(template)) writeAtomic(file, template);
      next[relative] = hash(template);
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    } else {
      result.preserved.push(relative);
      // An unchanged upstream template needs no merge or repeated warning.
      if (previous[relative] !== hash(template)) {
        writeAtomic(candidate, template);
        result.pending.push(relative);
      }
    }
  }
  writeAtomic(manifestFile, JSON.stringify({ version: 1, files: next }, null, 2) + "\n");
  return result;
}
