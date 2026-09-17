---
name: isp-job-management
description: Register, split, merge and track block or whole-graph JOBs, including converting plain user memos into work. Use for JOB 등록, 작업으로 남기기, 잡 쪼개기/합치기, or implementing queued requests; registration and restructuring alone do not execute work.
---

# Requests and JOBs

Read [shared rules](../isp-block-maker/common.md) once. Users write plain text; the agent organizes it into checkable work. `userRequests` retain original text and `jobs` hold work cards attached to blocks or `project.globalWork`. JOBs are not processing nodes. Reading does not consume or execute anything.

Start with `project`, `requests`, and `jobs`. Default lists include unfinished global and block work; inspect `scope` and `blockId` (null for global). `--block ID` or `--global` narrows the scope; these flags are mutually exclusive. `--all` includes history. “Block 메모 전부 구현해” covers all in-scope blocks/global work, not just the terminal's pinned node. Preserve a stable set of target IDs and read the relevant contracts/code before execution.

## Register without executing

“JOB 등록해”, “작업으로 남겨줘”, or “queue this” means create pending work unless execution is also requested. Select `--block ID` for the identified block or `--global` for whole-project work. Ask only if the target cannot be determined; do not silently use a pinned block or invent a global node.

```text
create-job --global --revision N --title "Compare output noise" --description "Acceptance: report noise and edge preservation."
create-job --block BLOCK_ID --revision N --file tmp/job-plan/job.json
```

The file is one `{"title":"...","description":"Intent, constraints and acceptance"}` object. Direct registration has no source request; do not fabricate/consume a memo. Register multiple independent tasks one at a time using each returned revision. Verify IDs, scope, pending state and report the titles/IDs in JOB Queue. Registration alone authorizes no implementation, start, completion or code commit.

## Convert existing memos

For an existing UI request, use `split-request` to preserve provenance. Decide which requests to take on within the user's task; unrelated or unclear text can remain unconverted. Split selected text into concrete checkable JOBs, preserving all constraints/unresolved parts and avoiding invented scope. One simple request may produce one JOB.

```text
split-request REQUEST_ID --block BLOCK_ID --revision N --file tmp/job-plan/jobs.json
```

The file is an array of `{ "title": "...", "description": "..." }` objects. This atomically consumes the source request as a conversion and creates linked pending JOBs; it is not completion. Original text remains visible and duplicate conversion is rejected. Do not use legacy `consume-request` for new work. Substitute `--global` for global text.

## Split or merge queued work

Read current JOBs before restructuring. All originals must be pending and within the same explicit scope. Do not silently reopen in-progress or completed work: reconcile the active worker first, and require a clear user decision to reopen completed work.

```text
split-job JOB_ID --block BLOCK_ID --revision N --file tmp/job-plan/split.json
merge-jobs JOB_ID,JOB_ID --global --revision N --file tmp/job-plan/merged.json
```

Split JSON is an array of at least two title/description objects. Merge JSON is one object; supply at least two distinct source IDs. Carry every constraint, acceptance criterion and dependency into the resulting descriptions without adding scope.

The server atomically replaces originals with pending cards, rewires source-request links, and preserves original IDs, titles, descriptions and notes in `sourceJobs`. `sourceRequestIds` contains every source, including merged requests; read all sources rather than only legacy `sourceRequestId`. Old IDs are no longer executable. Verify the resulting history and report old → new IDs/titles/scope. Restructuring does not execute, complete or commit anything.

## Execute only requested work

```text
start-job JOB_ID --block BLOCK_ID --revision N
complete-job JOB_ID --block BLOCK_ID --revision N --note "Changes; validation; commit HASH when applicable"
reopen-job JOB_ID --block BLOCK_ID --revision N --note "Remaining work"
```

Use `--global` for global JOBs. They may coordinate multiple blocks, but remain within graph implementation scope; identify affected blocks in descriptions. Select the appropriate [block development](../isp-block-development/SKILL.md), [Visualizations](../isp-visualizations/SKILL.md), [Image Viewer](../isp-image-viewer/SKILL.md) or [Documentation](../isp-documentation/SKILL.md) skill for the actual outcome. Start before working; reconcile ownership if already started. Complete only after the required implementation, accurate metadata, relevant validation and local commit for graph/code changes. Analysis-only work needs no empty commit. Keep unfinished work open and record accurate progress on interruption/failure.

Re-read JOBs before starting and completing. A user-deleted JOB is cancelled: do not recreate it from retained source text or keep implementing it. Reconcile cancellation at the next safe step if a shell process is already running. Superseded work also must not be executed. On stale revision or uncertain response, inspect current JOBs/history and changed request text before retrying; never duplicate registration or blindly repeat a split/merge. Preserve unrelated work during every mutation.

For implementation/analysis outcomes, use [completion.md](../isp-block-maker/completion.md) and report completed, remaining and cancelled work honestly. Queue-only changes need a brief ID/title/scope confirmation, not a fabricated work result.
