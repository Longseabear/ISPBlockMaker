import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { graphSchema, validateGraph } from "./model.mjs";
import { locateEntry, resolveSourceFile } from "./source.mjs";
import { sourceRoot } from "./project-layout.mjs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 100;
const symbolLanguages = {
  ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript",
  ".ts": "TypeScript", ".jsx": "JSX", ".tsx": "TSX",
};
const key = (file) => process.platform === "win32" ? file.toLowerCase() : file;
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join("/");
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const hasText = (value) => typeof value === "string" && Boolean(value.trim());

// The descriptor read, including a one-byte overflow probe, has a hard limit
// even when another process grows the file after stat().
async function readBounded(file, limit) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const evidence = { modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size };
    if (!stat.isFile()) return { skipped: "not_file", evidence };
    if (stat.size > limit) return { skipped: "limit", evidence };
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > limit) return { skipped: "limit", bytesRead: bytes, evidence };
    const read = buffer.subarray(0, bytes), content = read.toString("utf8");
    evidence.sha256 = createHash("sha256").update(read).digest("hex");
    return { content, bytesRead: bytes, binary: content.includes("\0"), evidence };
  } finally {
    await handle.close();
  }
}

function inspectStructure(graph, add) {
  const blocks = new Map();
  for (const block of graph.blocks) {
    if (blocks.has(block.id)) add("error", "block.duplicate_id", "Block IDs must be unique.", { blockId: block.id });
    blocks.set(block.id, block);
    for (const direction of ["inputs", "outputs"]) {
      const seen = new Set();
      for (const port of block[direction]) {
        if (seen.has(port.id)) add("error", "port.duplicate_id", `The ${direction} port ID is duplicated.`, { blockId: block.id, portId: port.id });
        seen.add(port.id);
      }
    }
  }
  const edgeIds = new Set(), targets = new Map();
  for (const edge of graph.edges) {
    const details = { edgeId: edge.id, blockIds: [edge.source, edge.target] };
    let valid = true;
    const fail = (code, reason) => { valid = false; add("error", code, reason, details); };
    if (edgeIds.has(edge.id)) fail("edge.duplicate_id", "Edge IDs must be unique.");
    edgeIds.add(edge.id);
    const source = blocks.get(edge.source), target = blocks.get(edge.target);
    const output = source?.outputs.find((port) => port.id === edge.sourceHandle);
    const input = target?.inputs.find((port) => port.id === edge.targetHandle);
    if (!source || !target) fail("edge.block_missing", "An edge endpoint refers to a block that does not exist.");
    else if (!output || !input) fail("edge.port_missing", "An edge must connect an existing output port to an existing input port.");
    else if (output.type !== input.type) fail("edge.type_mismatch", `Structured port types differ: ${output.type} → ${input.type}.`);
    const targetKey = `${edge.target}:${edge.targetHandle}`;
    if (targets.has(targetKey)) fail("edge.input_conflict", `This input already has an incoming edge (${targets.get(targetKey)}).`);
    targets.set(targetKey, edge.id);
    if (valid) add("check", "edge.ports_match", "Both endpoint ports exist and their declared types match.", details);
  }
  // Reuse the authoritative validator for cycles and other model invariants.
  // Detailed endpoint diagnostics above retain IDs rather than only a message.
  try {
    validateGraph(graph);
    add("check", "graph.structure_valid", "The graph satisfies the current structural model, including cycle and connection rules.");
  } catch (error) {
    add("error", "graph.structure_invalid", error.message);
  }
}

/** Inspect current graph metadata and source files without changing or executing them. */
export async function graphCheck(workspace, project, { blockId, changedFiles = [] } = {}) {
  const findings = [];
  const add = (severity, code, reason, details = {}) => findings.push({ severity, code, reason, ...details });
  const scope = { blockId: blockId ?? null, blockIds: [], edgeIds: [], changedFiles: [] };
  const impact = { changedFiles: [], blockIds: [], sharedFiles: [] };
  let filesChecked = 0, filesRead = 0, bytesRead = 0;
  const limitations = [
    "Read-only static checks do not execute source, tests, validation commands or Git operations, and do not update the graph.",
    "Human descriptions and agent contracts are free text. Their semantic agreement with code, runtime I/O, numerics and behavior is not inferred or proved.",
    "Symbol lookup is a lightweight declaration scan for Python, JavaScript, TypeScript, JSX and TSX. Unresolved, ambiguous or unsupported declarations require manual review.",
    "Source reads are limited to 2 MiB per file, 16 MiB total and 100 distinct files; an overflow probe may read one extra byte. Files can change during the check.",
    "Block selection limits source and metadata checks; structural validation covers the whole graph. Changed-file impact uses only the supplied source-relative paths and direct implementation mappings, not imports or call graphs.",
    "Missing metadata is a suggestion to clarify unspecified information. Optional contract fields are not all required, and prose is not parsed to guess missing I/O documentation.",
  ];
  const finish = () => {
    const counts = { check: 0, error: 0, warning: 0, info: 0 };
    for (const finding of findings) counts[finding.severity]++;
    return {
      ok: counts.error === 0,
      summary: { blocksChecked: scope.blockIds.length, edgesChecked: scope.edgeIds.length, filesChecked, filesRead, bytesRead, ...counts },
      scope, findings, impact, limitations,
    };
  };
  const parsed = graphSchema.safeParse(project);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 50)) {
      const index = issue.path[1];
      add("error", "graph.schema_invalid", issue.message, {
        field: issue.path.join("."),
        ...(issue.path[0] === "blocks" && project?.blocks?.[index]?.id ? { blockId: project.blocks[index].id } : {}),
        ...(issue.path[0] === "edges" && project?.edges?.[index]?.id ? { edgeId: project.edges[index].id } : {}),
      });
    }
    if (parsed.error.issues.length > 50) add("info", "graph.schema_truncated", "Only the first 50 schema issues are included.");
    return finish();
  }
  const graph = parsed.data;
  const selected = blockId === undefined ? graph.blocks : graph.blocks.filter((block) => block.id === blockId);
  scope.blockIds = selected.map((block) => block.id);
  scope.edgeIds = graph.edges.map((edge) => edge.id);
  inspectStructure(graph, add);
  if (!selected.length) add("error", "block.not_found", "The selected block does not exist.", { blockId });
  if (!hasText(graph.overview.entryPoint)) add("info", "metadata.entry_point_unspecified", "Consider documenting the project entry point so a reader can locate the overall flow.");
  for (const block of selected) {
    const details = { blockId: block.id };
    if (!hasText(block.description) && !hasText(block.detail)) add("info", "metadata.human_description_unspecified", "Consider a human-facing description of this block's purpose and input/output behavior.", details);
    for (const direction of ["inputs", "outputs"]) {
      if (block[direction].length && !hasText(block.agentContract[direction])) add("info", `metadata.agent_${direction}_unspecified`, `Consider describing ${direction} in the agent contract; the structured ports alone do not specify data shape or meaning.`, details);
    }
    if (!hasText(block.implementation)) add("info", "metadata.implementation_unspecified", "Consider recording the implementation file when one is available.", details);
    else if (!hasText(block.implementationSymbol)) add("info", "metadata.symbol_unspecified", "Consider recording an explicit function or class entry symbol for this implementation.", details);
  }

  let root;
  try { root = await fs.realpath(sourceRoot(workspace)); }
  catch (error) {
    add("error", "source.root_unavailable", `The source root could not be opened: ${error.message}`);
    return finish();
  }
  const mappings = [], resolved = new Map();
  async function identify(implementation) {
    let file;
    try { file = resolveSourceFile(workspace, implementation); }
    catch (error) { return { path: implementation, error: "unavailable", reason: error.message }; }
    if (!inside(root, file)) return { path: implementation, error: "outside" };
    const lexical = key(file), display = relativePath(root, file);
    if (resolved.has(lexical)) return resolved.get(lexical);
    let result;
    try {
      const canonical = await fs.realpath(file);
      result = inside(root, canonical)
        ? { path: relativePath(root, canonical), lexical, canonical, identity: key(canonical) }
        : { path: display, lexical, error: "outside" };
    } catch (error) {
      result = { path: display, lexical, identity: lexical, error: error.code === "ENOENT" || error.code === "ENOTDIR" ? "missing" : "unavailable", reason: error.message };
    }
    resolved.set(lexical, result);
    return result;
  }
  for (const block of graph.blocks) {
    if (hasText(block.implementation)) mappings.push({ block, file: await identify(block.implementation.trim()) });
  }

  if (!Array.isArray(changedFiles) || changedFiles.length > 1000) {
    add("error", "impact.invalid_changed_files", "changedFiles must be an explicit list of at most 1000 source-relative file paths.");
  } else {
    const seen = new Set();
    for (const changed of changedFiles) {
      if (!hasText(changed) || changed.length > 1000 || changed.includes("\0") || path.win32.isAbsolute(changed) || path.posix.isAbsolute(changed) || /^[a-z]:/i.test(changed)) {
        add("error", "impact.invalid_path", "Changed-file paths must be nonempty source-relative paths, not absolute paths.", { path: changed });
        continue;
      }
      const file = await identify(changed.replaceAll("\\", "/"));
      if (file.error === "outside") {
        add("error", "impact.path_outside_source", "The changed-file path resolves outside the source root.", { path: changed });
        continue;
      }
      if (seen.has(file.identity)) continue;
      seen.add(file.identity);
      const blockIds = [...new Set(mappings.filter((mapping) => mapping.file.identity === file.identity || mapping.file.lexical === file.lexical).map((mapping) => mapping.block.id))];
      scope.changedFiles.push(file.path);
      impact.changedFiles.push({ path: file.path, blockIds, shared: blockIds.length > 1 });
      add("info", blockIds.length ? "impact.changed_file" : "impact.unmapped_file", blockIds.length ? "Review all mapped blocks after changing this implementation; sharing a file does not prove that every symbol changed." : "No block directly maps to this file; indirect dependencies have not been inspected.", { path: file.path, blockIds });
    }
  }
  const shared = new Map();
  for (const { block, file } of mappings) {
    if (!file.identity) continue;
    const group = shared.get(file.identity) ?? { path: file.path, blockIds: [] };
    if (!group.blockIds.includes(block.id)) group.blockIds.push(block.id);
    shared.set(file.identity, group);
  }
  const selectedIds = new Set(scope.blockIds);
  impact.blockIds = [...new Set(impact.changedFiles.flatMap((file) => file.blockIds))];
  impact.sharedFiles = [...shared.values()].filter((group) => group.blockIds.length > 1 && (group.blockIds.some((id) => selectedIds.has(id)) || impact.changedFiles.some((file) => file.path === group.path)));
  for (const group of impact.sharedFiles) add("info", "implementation.shared_file", "Multiple blocks refer to this implementation file. Review their individual entry symbols and contracts when editing it.", group);

  const inspected = new Map();
  for (const { block, file } of mappings.filter(({ block }) => selectedIds.has(block.id))) {
    const details = { blockId: block.id, path: file.path };
    if (file.error) {
      add("error", `implementation.${file.error}`, file.error === "outside" ? "The implementation resolves outside the project source root." : file.error === "missing" ? "The implementation file does not exist." : "The implementation path could not be inspected.", details);
      continue;
    }
    let source = inspected.get(file.identity);
    if (!source) {
      filesChecked++;
      try {
        const stat = await fs.stat(file.canonical);
        const language = symbolLanguages[path.extname(file.canonical).toLowerCase()];
        if (!stat.isFile()) source = { error: "not_file" };
        else if (!language) source = { unsupported: true };
        else if (filesRead >= MAX_FILES || bytesRead >= MAX_TOTAL_BYTES || stat.size > Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - bytesRead)) source = { skipped: "limit" };
        else {
          filesRead++;
          source = { ...await readBounded(file.canonical, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - bytesRead)), language };
          bytesRead += source.bytesRead || 0;
          if (source.skipped === "not_file") source.error = "not_file";
        }
        source.evidence ??= { modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size };
      } catch (error) { source = { error: error.code === "ENOENT" ? "missing" : "unavailable" }; }
      inspected.set(file.identity, source);
    }
    if (source.evidence) details.sourceEvidence = source.evidence;
    if (source.error) {
      add("error", `implementation.${source.error}`, "The implementation could not be read as a regular source file.", details);
      continue;
    }
    add("check", "implementation.file_exists", "The implementation path resolves to a regular file inside the source root.", details);
    if (source.unsupported) {
      add("info", "implementation.symbol_review", "Symbol lookup is not supported for this file language. Review the entry declaration manually; no missing symbol is inferred.", { ...details, symbol: block.implementationSymbol });
      continue;
    }
    if (source.skipped) {
      add("warning", "implementation.read_limit", "Source inspection was skipped because the file or total read budget exceeds the checker limits. Review it manually.", details);
      continue;
    }
    if (source.binary) {
      add("warning", "implementation.binary", "The file contains NUL bytes and was not inspected as text. Review the implementation mapping manually.", details);
      continue;
    }
    if (!hasText(block.implementationSymbol)) continue;
    const entry = locateEntry(source.content, source.language, block.implementationSymbol);
    const entryDetails = { ...details, symbol: entry.entrySymbol };
    if (entry.entryFound) add("check", "implementation.symbol_found", "The declaration scan uniquely located the explicit entry symbol; its behavior and contract remain unverified.", { ...entryDetails, line: entry.startLine });
    else add("warning", "implementation.symbol_unresolved", "The declaration scan did not uniquely resolve the entry symbol. It may be absent, ambiguous or use unsupported syntax; review it manually.", entryDetails);
  }
  return finish();
}
