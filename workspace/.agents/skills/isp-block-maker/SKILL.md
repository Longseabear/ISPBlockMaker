---
name: isp-block-maker
description: Implement and edit ISP blocks, user request memos, graph connections, and visualization artifacts in this ISP Block Maker workspace. Use for implementing block memos, node creation/removal, implementation contracts, pipeline wiring, and registering image or HTML results in the local editor.
---

# ISP Block Maker workspace

Use this skill only for this `workspace/` tree, including its subdirectories. It is project-local, not a global skill. Work within the user's requested blocks and changes; this skill does not bypass the agent's normal shell/file permissions.

## Local entry point

Resolve `../../../isp.mjs` relative to this SKILL.md's directory to get the absolute workspace CLI path. Call `node "<absolute workspace>/isp.mjs" ...` from any directory within workspace. In the workspace root's cmd terminal, `isp ...` is a shortcut. Do not assume `../scripts` is valid from nested folders.

The server must already be running. The CLI uses inherited session credentials or the repository's `.isp/connection.json`; never print those credentials or copy them into instructions. Only loopback HTTP is accepted and redirects are rejected. If the server is unavailable, report that it needs starting rather than switching to a remote service.

## Read before editing

- `context`: the block pinned when this terminal was created.
- `context --block ID`: an explicit block.
- `context --selection`: explicitly adopt the UI selection.
- `project`: all blocks, edges, artifacts and current revision.

Keep the task's target block stable while the user clicks around. Read `agent.contract` for format, boundary, precision, steps, validation and acceptance requirements. `human` is the concise overview; `agent.shared` contains canonical ports and parameters. Blank contract fields are unspecified. Read the referenced implementation files before changing code; implementation paths are workspace-relative.

## Implement the graph, within its boundaries

The graph is the implementation boundary: implement the requested blocks, their declared behavior, and their connections. Map each processing stage to a graph node and inter-block data flow to its ports and edges. Do not add hidden processing stages, bypass connections, or expand a block task into unrelated application UI, services, infrastructure, or a general execution framework. “Implement all block memos” uses this same boundary.

Prefer a functional structure: a block entry point takes explicit inputs and parameters and returns explicit outputs; compose those entry points according to the graph. Prefer pure functions and explicit state over hidden globals or implicit cross-block calls. This is a preference, not a requirement to force every implementation into one function or one file. Internal helpers, shared math routines, and minimal adapters are allowed when they directly support the represented blocks without introducing new pipeline behavior.

When state, streaming buffers, hardware interfaces, performance, or existing code make pure functions impractical, use suitable classes, modules, mutable buffers, or other structures. Keep the block boundary and data flow clear, and document the entry point, state lifecycle, side effects, and reason in the block's implementation metadata/agent contract. Several nodes may share a file, but their corresponding operations must remain identifiable; do not merely relabel a monolithic implementation as separate blocks.

If a requested behavior needs a new stage or connection, represent it in the graph as part of the authorized change before treating the implementation as complete. Do not invent extra stages to justify scope expansion. If the needed graph change is outside the user's request, describe the gap and leave that portion pending. Necessary tests, fixtures, and requested visualizations may support graph implementation; they must not silently add behavior to the production pipeline. At completion, verify that code inputs/outputs and composition agree with the affected ports, edges, and contracts.

## User request memos

Users write plain text in a block's request box; do not require them to split or format tasks. Each block has `userRequests` (original text) and `jobs` (agent-managed work cards). JOB cards are attached to an IP node; they are not processing nodes or pipeline stages. `context` includes both in `agent.userRequests` and `agent.jobs`. Reading never consumes either.

For requests such as “Block 메모한 거 전부 구현해줘”, read both `requests` (unconverted text) and `jobs` (pending/in-progress work) across ALL blocks, regardless of the terminal's pinned block. Add `--block ID` to narrow either list or `--all` to include history. Capture the in-scope request IDs/texts and read the corresponding block contracts and code. Decide which requests to take on within the user's task; reading context does not automatically authorize unrelated work.

Break a chosen request into concrete, independently checkable JOBs that cover its intent, preserving constraints and unresolved parts without inventing scope. A simple request may produce one JOB. Write a JSON array to a file, for example `[{"title":"Implement threshold control","description":"Expose the existing threshold parameter; validate boundary values."},{"title":"Compare output","description":"Generate a before/after visualization from the implemented block."}]`, then:

```text
split-request REQUEST_ID --block BLOCK_ID --revision N --file jobs.json
jobs
start-job JOB_ID --block BLOCK_ID --revision N
complete-job JOB_ID --block BLOCK_ID --revision N --note "What changed and what validation passed"
reopen-job JOB_ID --block BLOCK_ID --revision N --note "What remains"
```

`split-request` atomically consumes the source request and creates pending JOBs linked to its ID. This means conversion, NOT implementation completion. The source text remains visible; duplicate conversion is rejected. Do not use the legacy `consume-request` shortcut for new work. Deferred or unclear source requests may remain unconverted; incomplete JOBs remain open. Finish each JOB only after implementation and relevant validation, recording evidence in `--note`. Use `start-job` before working; if another agent already started it, reconcile ownership instead of duplicating work. On interruption/failure, leave accurate progress or reopen the JOB with remaining work.

The user can remove any JOB using its × button. Re-read the current JOB before starting and before completing it. A deleted JOB is cancelled: do not recreate or continue it just because the retained source request still mentions it. Deletion cannot interrupt an already running shell command, so reconcile at the next safe step. All mutations return a new revision; stale conversion, completion, and deletion are rejected. Re-read and reconcile changed text or deleted JOBs instead of blindly retrying with a fresh revision. Preserve unrelated requests/JOBs during graph edits. Present the affected graph or visualization on completion and summarize completed, remaining, and cancelled work accurately.

## Graph mutations

### Global graph requests and JOBs

The editor's Global requests panel holds plain-text requests for the whole graph. They live in `project.globalWork`, outside the Git graph specification, and follow the same conversion, validation, deletion, and completion rules as block work. Default `requests` and `jobs` include both global and block items; inspect `scope` (`global` or `block`) and `blockId` (null for global). Use `requests --global` / `jobs --global` to narrow to graph-wide work, or `--block ID` for a block; these flags are mutually exclusive.

For global items, replace `--block ID` with `--global` in `split-request`, `start-job`, `complete-job`, and `reopen-job`. Example: `split-request REQUEST_ID --global --revision N --file jobs.json`. Global JOBs may coordinate several blocks but remain bounded by the graph implementation rules; they do not authorize unrelated application changes. Read `project` and relevant block contexts, preserve which blocks each JOB affects in its description, and record validation plus the commit hash when completing it. Do not invent a global processing node or use a fake block ID.

Version `workspace/graph.json` together with implementation code in Git. This file contains only the graph specification; the bridge merges it with ignored local requests, JOBs, artifact records and session state for API responses. Never save a full `project` response directly into graph.json or commit `.isp` as graph history. Use the API for normal edits. After restoring graph/code with Git, re-read context/project and refresh the browser; previous revisions are stale. Local work/results remain attached by stable node ID even when that node is temporarily absent. Do not reuse an old ID for an unrelated block. Historical results are retained, not automatically rerun or validated against restored code.

Replace N below with the revision you inspected. Each successful graph mutation returns the new project and revision; use it for the next mutation. A conflict requires re-reading and reconciling, never blindly retrying with a fresh revision.

```text
add-block block.json --revision N
update patch.json --block ID --revision N
delete-block ID --revision N
delete-block ID --revision N --with-edges
connect SOURCE:PORT TARGET:PORT --revision N --id EDGE_ID
disconnect EDGE_ID --revision N
mermaid
```

`add-block` requires a JSON object with stable `id` and `name`. Optional fields are description, principle, implementation, agentContract, status (draft/implemented), inputs, outputs, parameters and position. Omitted ports are empty; omitted text is empty, status is draft, and position is (300,300). A port is `{"id":"image","name":"Image","type":"image"}`; supported types are image/mask/signal. Write enough description and contract for another agent to implement the block; use `context` on an existing block as a schema example.

`update` is a partial block object. Put human-facing purpose in description, algorithm in principle, and detailed constraints in agentContract: dataFormat, boundaries, numerics, steps, validation, acceptance. Keep common ports/parameters in their canonical fields.

Set `implementationSymbol` to the node's entry function/class (for example `flat_detection` or Python `Denoiser.process`), especially when nodes share an implementation file. Keep it updated when renaming or moving the entry point. The code viewer jumps to this symbol; if omitted it tries the block ID with hyphens replaced by underscores. Missing or ambiguous symbols leave the view at the top with a notice. Do not invent separate entry points for nodes that still share a monolithic operation; reflect actual code structure.

Deleting a connected node requires `--with-edges` and removes its incident edges atomically. It retains implementation files and historical artifacts. Only use that option when the requested node deletion includes disconnecting it. The final node cannot be deleted. Port type mismatch, multiple drivers for an input and cycles are rejected by the server. Do not edit `.isp/project.json` directly.

## Automatic local Git commits

The user authorizes local commits as part of implementing graph/block changes in this workspace. After implementation, relevant validation, and saving the corresponding graph metadata, create a local commit containing the coherent graph/code change before marking its JOB complete. Do this without asking for confirmation each time. Follow any later explicit instruction to skip commits. This is an agent workflow rule, not a filesystem watcher or automatic commit on every UI save; it does not authorize pushing, publishing, or rewriting history.

Use the existing repository containing this workspace (`git rev-parse --show-toplevel`). Do not create a nested repository or move the workspace. The required versioned content is `workspace/graph.json` and the implementation sources, necessary helpers, and tests belonging to the change. New source files must be explicitly added; merely placing a file in workspace does not track it. Respect `.gitignore`: `.isp/`, generated visualization files under `workspace/artifacts/generated/`, credentials, runtime files, and temporary JOB JSON are not commit content.

Inspect Git status and diffs before editing and again before committing. Include only the task's relevant changes; do not use blanket `git add .`, `git add -A`, or `git commit -a`. Preserve existing user staging and unrelated work. If a file mixes unrelated edits, isolate the task's changes without discarding or committing the unrelated edits. If this cannot be done reliably, report the concrete blocker and leave the affected JOB open rather than claiming a saved version. Do not reset or stash user work to force a clean tree. Check the staged content and final commit paths so other staged changes are not accidentally included.

Commit graph metadata and its matching implementation together when both changed; do not manufacture changes to an unchanged graph. A JOB normally gets one meaningful commit, but dependent JOBs may share one commit when needed to keep the pipeline consistent. Use a descriptive message mentioning relevant block/JOB IDs. For the first commit in an empty repository, include the graph and the implementation dependencies needed for the scoped baseline; do not sweep unrelated application files into the commit. If Git identity or hooks prevent committing, report the failure without changing identity, bypassing hooks, or claiming completion.

Verify the created commit and obtain its full hash with `git rev-parse HEAD`. Then re-read the JOB and current project revision and call `complete-job ... --note "Implemented ...; validation ...; commit <full hash>"`. The JOB record is local, so writing this note does not require another commit. Without a JOB, report the commit ID in the final response. If graph/source files changed again after validation or commit, reconcile and validate the affected changes before claiming they belong to that commit. For a visualization-only or read-only task with no versioned changes, do not create an empty commit; record that no code change was made, and reference HEAD only if it exists and accurately represents the source used (otherwise describe uncommitted source changes).

## Implementation and visualization outputs

Edit source files normally, run relevant validation, then update metadata through the CLI. Skills and metadata are instructions, not proof that an implementation passed validation.

Create outputs under `workspace/artifacts/generated/`. Register with:

```text
artifact result.html --block ID --revision N --title "Comparison" --run RUN_ID
demo
```

Use the revision captured when the result was produced, not a newer revision observed afterward. HTML must be self-contained (inline JS/CSS, data images) and runs in a sandbox without network or parent app access. PNG/JPEG/WebP are also supported; maximum file size is 10MB. `demo` runs the provided synthetic grayscale reference example, not a general graph executor or RAW/RTL validation.

After mutations, inspect returned state or query context to confirm target IDs, port connections and artifact registration. Report what changed and what validation actually ran.

## Present the finished result

At the end of an authorized task, leave the user looking at the most useful result using `present`. Choose one final view rather than switching repeatedly during intermediate edits. If the user requested a particular view or asked to keep their current view, follow that preference.

| Finished work | Present |
| --- | --- |
| Add or modify a block, implementation, or contract | Graph with the affected block highlighted; single-block presentation opens its inspector |
| Add or modify connections | Highlight the exact surviving edges with `--edges`; their endpoint nodes are automatically highlighted and fitted together |
| Change several blocks | Highlight the affected blocks, optionally with relevant edges |
| Delete a block | Highlight relevant surviving neighbors, or show the graph overview; never reference the deleted ID |
| Create an image, plot, comparison, or HTML report | Visualizations with the exact newly registered artifact selected |
| Modify code and create a useful comparison | Prefer the comparison; mention modified block IDs in the completion message |
| Read-only explanation or failed/incomplete work | Usually keep the current view; only present existing evidence relevant to the explanation, with an accurate message |

```text
present --blocks denoise --message "Denoise updated; validation passed"
present --blocks flat-detection,denoise --message "Mask connection updated"
present --edges mask-denoise --message "Flat mask connection updated"
present --blocks denoise --edges mask-denoise --message "Block and connection updated"
present --artifact ARTIFACT_ID --message "Before/after comparison ready"
present --graph --message "Block removed; remaining pipeline shown"
```

Use actual IDs returned by project/registration commands. Never invent an artifact ID or claim a test passed unless it ran successfully. Run relevant validation before presenting a success result. Preserve the result's recorded revision; presentation does not modify graph metadata or mark an old result current.

Use actual edge IDs from `project` or the successful `connect` response. `--edges` accepts comma-separated IDs and can be combined with `--blocks`. It highlights the edge paths and automatically includes both endpoints in the fitted view. After disconnecting/deleting an edge, use `--blocks` for its surviving endpoints and explain the removal; a deleted edge cannot be highlighted. Prefer the smallest relevant set so the changed connection is easy to see. A later presentation replaces previous highlights; manually selecting a block clears them.

`present` requests graph selection/highlights/fit or artifact-tab navigation on currently connected editor tabs. It preserves terminal visibility and the running session. It does not change the terminal's pinned work target. Unsaved inspector edits defer the request behind a “결과 보기” button; do not force-discard edits. Check the response: `delivered: 0` means there was no connected screen, not that the result was shown. Do not start a browser or repeatedly resend just to force attention; report that the result is registered and can be opened. Delivery is not an acknowledgment that the user viewed it.

Finish with a brief human-facing message: what changed, what was validated, and which block/result to inspect. Do not dump raw project JSON into the completion message.
