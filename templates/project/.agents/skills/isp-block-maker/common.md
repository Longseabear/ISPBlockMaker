# Shared workspace rules

Read once per project; do not reload for every related skill. Resolve all reference links relative to their containing file, not the shell working directory.

## Local CLI and context

From this directory (`<workspace>/.agents/skills/isp-block-maker`), resolve `../../../.isp/tools/isp.mjs` to an absolute path. Run `node "<workspace>/.isp/tools/isp.mjs" COMMAND ...` from anywhere inside the workspace. In its cmd terminal, `isp COMMAND ...` is a shortcut; `"<workspace>/.isp/tools/isp.cmd"` also uses the configured Node executable. The command examples in these skills omit this prefix. `isp-block-maker` is a separate launcher/bundle command, not this bridge CLI.

The project server must be running. Use inherited local credentials or `.isp/connection.json`; do not print/copy tokens into logs or instructions. The bridge accepts loopback HTTP only and rejects redirects. If the connection fails, check that the CLI and active server belong to this project; do not switch to a different workspace or remote service to bypass an error.

| Read command | Meaning |
| --- | --- |
| `workspace-info` | Absolute workspace/source roots, graph file, data and scratch directories |
| `context` | Block pinned when the terminal was created |
| `context --block ID` | An explicit block and its context |
| `context --selection` | Adopt the block currently selected in the UI |
| `project` | Graph, local requests/JOBs/results and current revision |
| `graph-info` | Whole-graph purpose, entry points and agent notes |
| `graph-check` | Read-only graph/source findings and affected block mapping; see [change-impact.md](change-impact.md) |
| `recipes` / `recipe-show ID` | Reusable project commands; see [execution-recipes.md](execution-recipes.md) when running or authoring one |

Keep the task's block target stable as the user clicks around. For whole-graph tasks read the overview and relevant blocks, not only the pinned block. `human` contains human explanations, `agent.contract` the technical contract, and `agent.shared` canonical ports/parameters. Blank fields are unspecified. Verify referenced source files before relying on old notes.

Read `workspace-info` before using filesystem paths. Its `workspace`, `sourceRoot`, `graphFile`, `dataDir`, and `tmpDir` are authoritative; do not guess from the terminal directory or rewrite legacy layouts yourself. In the separated layout, graph/code/tests and their own Git repository live in `<workspace>/project/`; local state, skills, input data and scratch files remain at workspace level. A block's `implementation` and source references are relative to `sourceRoot` (for example `blocks/filter.py`, not `project/blocks/filter.py`). Run source code from `sourceRoot`, Git as `git -C "<sourceRoot>" ...`, and use absolute paths from discovery for bridge JSON, inputs and outputs. `../data/` is an input path only when the discovered layout confirms it.

## Consistent edits and files

Use the revision you actually inspected for each mutation. A successful mutation returns the next revision. On a conflict or uncertain response, read current state and reconcile changed text, existing results, and deleted items before retrying; merely substituting a fresh revision can lose user work or duplicate it.

The discovered `graphFile` contains the versioned graph specification. API `project` additionally merges local requests, JOBs, artifacts and session state: never write that whole response into `graph.json`. Use the bridge for normal metadata edits and never directly edit `.isp/project.json` or tracking records. Stable block IDs retain local history; do not reuse them for unrelated nodes.

Keep intermediate scripts, patch/JOB/summary JSON, debug files and exploratory outputs in `<tmpDir>/<task-or-job-id>/`. Paths such as `tmp/...` and `artifacts/generated/...` in these guides are workspace-relative examples; resolve them explicitly when executing from `sourceRoot`. Final source/tests belong in `sourceRoot`; stable input data and registered output files belong in their appropriate workspace locations outside `tmp/`. See [temporary-files.md](temporary-files.md) when promoting or cleaning results. `.isp/` holds valuable framework-managed work/results, not disposable scratch work. These are workspace-local rules; image imports may read explicitly requested external image files without modifying their originals.

For completed or stopped implementation/analysis, read [completion.md](completion.md) to record evidence and show the useful result. A read-only context lookup or queue-only edit does not need a fabricated experiment, commit, or report.

Report HTML and its generator are editable. The restriction on directly editing framework state does not prohibit editing report content. Edit the authoring HTML, then use `artifact-update` to refresh the registered copy (see `../isp-visualizations/SKILL.md`); do not patch the managed artifact file or registry behind the server.

## Project skill judgment

At substantive planning decisions, reusable discoveries, and completion, briefly assess whether the knowledge should become a project skill. Do not turn every thought, one-off result or block description into a skill. Prefer a tested, recurring project/framework-specific procedure with a clear trigger (for example RAW decoding conventions, a block-family validation recipe, or local C-model adaptation rules). Check `skills` / `context.projectSkills` for an existing match; improve it instead of duplicating it. Creating or updating such a workspace-local skill is allowed when useful within the user's task; it does not authorize unrelated implementation or sharing.

Read [project-skills.md](project-skills.md) when creating, editing or sharing a project skill. Keep current algorithm facts, entry points and experiment outcomes in graph/block metadata or activity records; put reusable **how-to** knowledge in project skills. Load only descriptions first, then the relevant skill. No skill is permission to ignore user constraints or execute imported scripts blindly.

## Change impact

During graph-related implementation and analysis, use [change-impact.md](change-impact.md) at meaningful phase boundaries and completion. It selects checks and affected records by the actual change, with [graph-maintenance.md](graph-maintenance.md) for information placement. This is an in-task practice, not periodic background mutation.
