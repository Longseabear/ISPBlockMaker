# Workspace-local project skills

Use Project Skills for reusable procedures specific to this ISP project or its private target framework: RAW layout conventions, repeatable WB/quality checks, block-family validation, or adaptation recipes. Current implementation facts and one-off measurements belong in node/graph metadata and activity records. Consider skill value when planning, discovering reusable knowledge and finishing; do not create a file for every reasoning step. Prefer updating an existing skill, and avoid duplicating the framework's built-in `isp-*` instructions.

## Find and author

`isp skills` lists descriptions and versions. `isp skill-show NAME` returns all supporting text files and the optimistic version hash. `context` includes a concise project skill catalog. Read relevant entries, not the whole collection. A newly saved native skill may require the agent's catalog refresh/new session; it can always be read immediately with these CLI commands.

Create JSON under the discovered `tmpDir` and call `isp skill-save FILE.json`:

```json
{
  "name": "sensor-raw-validation",
  "version": null,
  "files": {
    "SKILL.md": "---\nname: sensor-raw-validation\ndescription: \"Use when validating this project's sensor RAW decoding and CFA phase.\"\n---\n\n# Sensor RAW validation\n\nRecord verified conventions, explicit unknowns, repeatable checks and local relative references here.\n"
  }
}
```

On update supply the exact version from `skill-show` and the **complete** desired files map. Missing files are removed from the active skill, with a local backup. On conflicts reread and reconcile; do not blindly replace the hash. `isp skill-delete NAME --version HASH` archives the skill. UI edits and agent edits use the same files and version guards.

Names are lowercase hyphenated identifiers, at most 64 characters. `isp-*` and framework template names are reserved. SKILL.md requires matching `name` and a concise `description` containing use conditions. Body language is flexible: choose whatever conveys the project rules most precisely. Document validated behavior, useful commands, expected outputs, failure conditions, and uncertainty. Do not claim scripts are tested unless they were actually run successfully. Local text supporting files can include `references/*.md`, `scripts/*.py`, JSON/YAML and other supported text sources (50 files / 2 MiB per skill, 256 KiB per file).

The canonical location is `<workspace>/.agents/skills/NAME/`. A Claude entry links to it under `.claude/skills/NAME/`. This is workspace-local, including its subdirectories; no global skill installation occurs. Do not write into framework templates or bypass the API's reserved-name protections. If an existing independent Claude skill conflicts, preserve it and resolve the naming conflict rather than replacing it.

## Share and import

Project Skills → select skills → **선택 스킬 공유** creates `project.skills.bundle`. This ZIP contains a typed manifest and only selected skill files; Claude entries are regenerated on import. Project Skills → **스킬 번들 열기** previews files and conflicts, then installs only explicitly selected items. A same-name selection explicitly replaces that skill; stale preview versions are rejected. Import reads text without executing scripts. Inspect imported instructions and scripts before use; inclusion in a bundle does not make them trusted or authorize new actions.

Ordinary project `.bundle` sharing includes workspace skills together with graph/code/results. Use the Skills tab for a skills-only bundle and the project bundle dialog for a complete workspace; they are different package types. Before sharing, remove project secrets, absolute machine paths and irrelevant data. A skill may reference project dependencies without containing them: document those requirements and avoid claiming a skills-only bundle includes code or RAW inputs.

Earlier revisions and deleted skills are retained under `.isp/skill-history/` locally and excluded from shared bundles. The active skill files are the source of truth; this is not a substitute for source-code Git history or a task log.

CLI sharing is also available:

```sh
isp skill-export sensor-raw-validation,wb-check --out tmp/project.skills.bundle
isp skill-import-preview tmp/project.skills.bundle
isp skill-import tmp/project.skills.bundle --choices tmp/skill-choices.json
```

The choices file is an array of `{ "name": "sensor-raw-validation", "version": null }` for a new skill, or the exact current version from preview for an intentional replacement. Preview and inspect first; never replace conflicts simply to make import succeed. Export uses exclusive creation and will not overwrite an existing output file.
