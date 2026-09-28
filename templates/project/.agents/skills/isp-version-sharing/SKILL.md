---
name: isp-version-sharing
description: Track ISP work attempts and graph/code checkpoints, compare or restore implementations, inspect branches/tags/commits, and create/open portable project bundles. Use for work history, completed-result tags or .bundle sharing; framework releases and external publishing are outside the project workflow.
---

# Project versions and sharing

Read [shared rules](../isp-block-maker/common.md) once and discover `sourceRoot` with `workspace-info`. The independent source repository owns `graph.json`, implementation sources and required helpers/tests, normally in `<workspace>/project/`. The framework repository is separate. Workspace `.isp/` holds persistent requests, JOBs, attempts, checkpoint metadata, artifacts and session state; data and generated outputs stay outside the source repository.

## Checkpoint coherent implementation changes

For substantial algorithm/JOB work, read [work-tracking.md](work-tracking.md). Attempts connect intention, baseline, execution conditions, validation and result; checkpoints preserve the whole graph/code state. A JOB can have several attempts and an attempt can cover several scoped JOBs. Registration-only, context lookup and minor text edits do not need an artificial experiment.

Inspect source status/diffs before editing so existing user changes remain identifiable. After relevant validation and accurate graph descriptions/contracts, save the coherent source with `checkpoint --title "Meaningful result"`; verify the returned ID and source identity. A checkpoint captures the current graph/code tree, including nonignored untracked files, using a separate Git index and durable ref. It preserves the current branch HEAD and real staging. It is not a normal branch commit or proof that captured files were tested. Do not attribute pre-existing user edits to your work; include their presence in the attempt when relevant. Snapshotting an unchanged source for another input run is valid; do not manufacture changes.

For a result attempt, link the checkpoint whose source actually produced the recorded evidence. If source changed after the run, use the explicit tested checkpoint or rerun on the final source; never relabel old output with the newest snapshot. Follow [completion.md](../isp-block-maker/completion.md). A saved checkpoint does not accept the candidate, complete a JOB, create a tag or publish anything.

## Conventional Git when requested

Use `git -C "<sourceRoot>" ...`, and verify its own `.git` and `rev-parse --show-toplevel` identify that exact root. Never use the ancestor workspace/framework repository. A missing/unavailable source Git is a concrete version-management limitation; do not redirect commits elsewhere.

For requested normal commits, inspect initial/final status and diffs. Explicitly stage relevant files or hunks, including matching graph metadata and generators. Preserve existing user staging and unrelated edits; never blanket `git add .`, `git add -A`, `git commit -a`, reset, or stash to force completion. If mixed changes cannot be isolated, describe the blocker. Respect ignored paths and credentials/runtime exclusions. Do not change Git identity or bypass hooks to conceal a failure. Verify the resulting full hash. A checkpoint needs no duplicate normal commit; push, publication, history rewriting and tags require their own user intent.

## Inspect or select a version

`attempts` lists work and its results; `checkpoints` lists reproducible source snapshots. For comparisons/restoration use [work-tracking.md](work-tracking.md). Current implementation, viewed artifact and accepted attempt are independent states: displaying or accepting a historical result does not switch code.

The version UI presents tags as finished results and commits as intermediate snapshots; neither label proves correctness. Read actual refs, hashes and diffs before describing them. Do not create a tag, switch versions or restore merely because work finished. Whole-project checkpoint restoration requires the user's restore intent and a fresh preview; node-only restore is not supported because nodes may share files and contracts.

After a requested restore, re-read context/project: old API revisions are stale. Local results/JOBs remain attached by stable node ID even while a node is absent. Restoring source does not rerun visualizations or reset JOB status. Do not reuse an old ID for an unrelated block.

## Portable `.bundle`

This is an ISP workspace archive, not a plain `git bundle`, framework release or external upload. Use the installed launcher **`isp-block-maker`**, not the workspace `isp` bridge. Prefer the discovered workspace root; a recognized `project/` source-folder alias is normalized to its containing workspace, so passing it does not mean a code-only export:

```text
isp-block-maker pack "<workspace>" --dry-run
isp-block-maker pack "<workspace>" -o "<workspace>/Project name.bundle" --with-git
isp-block-maker pack "<workspace>" -o "<workspace>/Selected results.bundle" --visualizations ARTIFACT_ID,ARTIFACT_ID --without-images
isp-block-maker open "Project name.bundle" --into "C:\Work\NewProject"
isp-block-maker open "Project name.bundle" --into "C:\Work\ExistingProject" --overwrite
```

Use a filesystem-safe form of the actual project name and an explicit output path outside `sourceRoot`, so bundles do not enter later source checkpoints. `pack` refuses to overwrite its output file; choose a new name when needed. Default content includes current graph/code/skills, local requests/JOBs, tracking records, registered visualizations/documents, Viewer data and workspace input data. **Use `--with-git` to make historical checkpoints restorable after sharing.** Tracking metadata alone cannot reconstruct their source trees. Without Git history, only the current implementation travels; describe older checkpoint restore limitations accurately.

The UI's **공유 → .bundle 저장** always includes the project and lets the user include all, selected or no visualizations, with separate Viewer and input-data options. CLI equivalents, also usable with `--dry-run`:

- `--visualizations ID,ID`: include only those registered visualizations/documents; use actual artifact IDs.
- `--without-visualizations`: exclude all registered visualizations/documents; do not combine with `--visualizations`.
- `--without-images`: omit Viewer originals while retaining saved crops. `--without-viewer` instead omits all Viewer data.
- `--without-data`: omit workspace input data. Code references to omitted inputs may require recipient setup.

Workspace `tmp/`, dependencies/caches, credentials and connection/session files are excluded. Match selections to the user's sharing intent and inspect the preview; do not silently include unrelated inputs or claim omitted files are portable.

**번들 열기** offers a new folder or replacement of an existing ISP workspace. New-folder mode restores/setup and opens the resulting workspace. Replacement requires explicit overwrite intent and the UI's target/backup confirmation; it checks a fresh destination snapshot, preserves the old folder as a sibling backup, stops affected terminals/server as needed, then replaces the workspace. It is replacement, not a merge of files or history. Keep and report the returned backup path. If the target changed, refresh the preview and reconcile instead of bypassing the check.

For CLI replacement use `open ... --into EXISTING_WORKSPACE --overwrite` only after that workspace's server is stopped; do not force it past an active-server error. Explicit user overwrite intent authorizes that workflow without an extra generic approval step. `open` validates and sets up the workspace, then launches its server/browser; `--no-open` performs extraction/setup only. A bundle does not supply an agent CLI, Python environment, externally referenced data or proof that the recipient can execute the implementation. Report the restored location and included content accurately.
