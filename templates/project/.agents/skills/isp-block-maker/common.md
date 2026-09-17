# Shared workspace rules

Read once per project; do not reload for every related skill. Resolve all reference links relative to their containing file, not the shell working directory.

## Local CLI and context

From this directory (`<workspace>/.agents/skills/isp-block-maker`), resolve `../../../.isp/tools/isp.mjs` to an absolute path. Run `node "<workspace>/.isp/tools/isp.mjs" COMMAND ...` from anywhere inside the workspace. In its cmd terminal, `isp COMMAND ...` is a shortcut; `.isp/tools/isp.cmd` also uses the configured Node executable. The command examples in these skills omit this prefix. `isp-block-maker` is a separate launcher/bundle command, not this bridge CLI.

The project server must be running. Use inherited local credentials or `.isp/connection.json`; do not print/copy tokens into logs or instructions. The bridge accepts loopback HTTP only and rejects redirects. If the connection fails, check that the CLI and active server belong to this project; do not switch to a different workspace or remote service to bypass an error.

| Read command | Meaning |
| --- | --- |
| `context` | Block pinned when the terminal was created |
| `context --block ID` | An explicit block and its context |
| `context --selection` | Adopt the block currently selected in the UI |
| `project` | Graph, local requests/JOBs/results and current revision |
| `graph-info` | Whole-graph purpose, entry points and agent notes |

Keep the task's block target stable as the user clicks around. For whole-graph tasks read the overview and relevant blocks, not only the pinned block. `human` contains human explanations, `agent.contract` the technical contract, and `agent.shared` canonical ports/parameters. Blank fields are unspecified. Verify referenced workspace-relative source files before relying on old notes.

## Consistent edits and files

Use the revision you actually inspected for each mutation. A successful mutation returns the next revision. On a conflict or uncertain response, read current state and reconcile changed text, existing results, and deleted items before retrying; merely substituting a fresh revision can lose user work or duplicate it.

`graph.json` contains the versioned graph specification. API `project` additionally merges local requests, JOBs, artifacts and session state: never write that whole response into `graph.json`. Use the bridge for normal metadata edits and never directly edit `.isp/project.json`. Stable block IDs retain local history; do not reuse them for unrelated nodes.

Keep intermediate scripts, patch/JOB/summary JSON, debug files and exploratory outputs in `tmp/<task-or-job-id>/`. Final source, tests, stable inputs and registered outputs belong outside `tmp/`. See [temporary-files.md](temporary-files.md) when promoting or cleaning results. `.isp/` holds framework-managed state, not scratch work. These are workspace-local rules; image imports may read explicitly requested external image files without modifying their originals.

For completed or stopped implementation/analysis, read [completion.md](completion.md) to record evidence and show the useful result. A read-only context lookup or queue-only edit does not need a fabricated experiment, commit, or report.
