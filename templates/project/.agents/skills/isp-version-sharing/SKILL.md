---
name: isp-version-sharing
description: Save coherent ISP project graph/code commits, inspect or select branches/tags/commits, and create/open portable project bundles. Use for version history, completed-result tags or .bundle sharing; framework releases and external publishing are outside the project workflow.
---

# Project versions and sharing

Read [shared rules](../isp-block-maker/common.md) once. The independent project owns `graph.json`, implementation sources and required helpers/tests. Framework source/server is a different repository. `.isp/` holds local requests, JOBs, artifacts and session state; generated outputs and `tmp/` are not graph history.

## Local commit workflow

The user authorizes local commits as part of implementing graph/block changes in this workspace, after relevant validation and accurate metadata. No repeated confirmation is needed unless a later instruction says to skip commits. This is an agent completion workflow, not a filesystem watcher, commit on every UI save, or authorization for pushing/publishing/history rewriting.

Verify `git rev-parse --show-toplevel` is exactly the project root and that its own `.git` exists. Never commit through an ancestor/framework repository. If absent, report version management as unconfigured instead of committing to the framework.

Inspect status/diffs before editing and before committing. Explicitly stage only relevant files or hunks, including newly created sources; never use blanket `git add .`, `git add -A`, or `git commit -a`. Preserve existing user staging and unrelated edits. Check final staged content/commit paths so unrelated staged changes are excluded. Do not reset/stash user changes to force a clean tree. If mixed changes cannot be isolated reliably, report the blocker and leave the relevant JOB open rather than claiming a saved version.

Commit matching graph metadata/code/generator changes together when both changed; do not manufacture a graph edit. A JOB normally gets a meaningful commit, while dependent JOBs may share one coherent commit. Include relevant block/JOB IDs in its message. An initial commit includes the graph and dependencies needed for this scoped baseline, not unrelated application files. Respect ignored `.isp/`, `artifacts/generated/`, `/tmp/` and credentials/runtime exclusions. A Git identity or hook failure is a concrete blocker; do not change identity or bypass hooks to hide it.

Verify the new commit with `git rev-parse HEAD`. Re-read the JOB and revision before `complete-job ... --note "Changes; validation; commit FULL_HASH"`. Local JOB notes need no second commit. Without a JOB, include the commit ID in the final response. Reconcile files changed after validation/commit before claiming that commit represents them. Read-only/visualization-only work with no versioned changes needs no empty commit; record the actual source HEAD/dirty state instead.

## Inspect or select a version

The UI presents tags as finished results and commits as intermediate snapshots; neither label proves correctness. Read actual names, hashes and diffs (`git status --short`, `git log`, `git tag`, `git branch`) before describing or selecting them. Do not create a tag, switch branches, restore files or rewrite history merely because an implementation task finished. Follow the user's explicit version selection and preserve current edits; explain a concrete conflict rather than discarding it.

After a requested graph/code restore, re-read context/project and refresh the editor; older API revisions are stale. Local results/work remain attached by stable node ID even while a node is absent. Restoring source does not rerun old visualizations or validate them against the selected code. Do not reuse an old ID for an unrelated block.

## Portable `.bundle`

This is an ISP project archive, not a plain `git bundle`, framework release or external upload. Use the installed launcher command **`isp-block-maker`**, not the workspace `isp` bridge:

```text
isp-block-maker pack . --dry-run
isp-block-maker pack . -o "Project name.bundle"
isp-block-maker open "Project name.bundle" --into "C:\Work\NewProject"
```

Read the project's actual name and use a filesystem-safe form for the output filename. `pack` refuses to overwrite an existing file; choose a new name when needed. Inspect its plan and requested content. Default bundles contain graph/code/skills, local requests/JOBs, registered results/documents and Viewer crops/originals. Add `--without-images` to omit Viewer originals (saved crops remain), or `--with-git` when the user wants repository history. Those options can also accompany `--dry-run`. Root `tmp/`, dependencies/caches, credentials and connection/session files are excluded; final dependencies must not point into tmp.

`open` requires a new destination, validates/restores the bundle, supplies local setup and launches its server/browser. Add `--no-open` for extraction/setup only. The UI's **번들 열기** and **공유 → .bundle 저장** provide the same workflows. Do not unpack over an existing project. A bundle transports stored work/results, not the agent CLI, Python environment or a guarantee that the implementation runs on the recipient's machine. Report what was included and the saved/restored path accurately.
