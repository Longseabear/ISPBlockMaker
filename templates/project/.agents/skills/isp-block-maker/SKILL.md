---
name: isp-block-maker
description: Orient work in an ISP Block Maker project and choose the relevant local workflow when a task spans several tools or its destination is unclear. Use for development harness creation/execution/sharing, project context, selected-block questions, UI control (Board highlighting and automatic framing, opening reports/images), and routing existing ISP Block Maker instructions.
---

# ISP Block Maker

The board is a big-picture map of major processing stages and data flow. Consult it when useful for the task; reading or updating it is not a gate for every request. Keep affected structure, meaningful descriptions and source references consistent when they change. Do not turn helper functions or incidental implementation details into nodes.

Read [common.md](common.md) once for this project. These skills apply to the workspace containing this file and its subdirectories; they are not global instructions.

## UI control: show, highlight and fit the Board

Use this section when the user asks to show the block diagram, highlight blocks/connections, zoom in on a block, or fit the graph to the screen. These are UI actions; do not change graph positions or implementation code just to change the view.

Run `node .isp/tools/isp.mjs` from the workspace (or use ISP_CLI). Read `graph-info` / `project` to resolve names to actual IDs and the selected diagram before presenting targets.

| User intent | CLI command after the CLI prefix |
| --- | --- |
| Show the whole Board / fit all blocks on screen | `present --graph` |
| Highlight and fit specified blocks | `present --blocks BLOCK_ID,BLOCK_ID` |
| Highlight connections and fit their endpoint blocks | `present --edges EDGE_ID,EDGE_ID` |
| Open an existing registered report | `present --artifact ARTIFACT_ID` |
| Display a source image | `viewer-open FILE`; follow the isp-image-viewer skill |

Add `--message "Short explanation"` when useful. `present` uses POST `/api/present`; the Board automatically fits the requested targets. A single block also opens its details. This is programmatic automatic framing, so do not claim the Board has no CLI/API zoom capability. Exact graph zoom percentages, relative zoom steps and arbitrary camera coordinates are not exposed: explain that limitation and offer target fitting. Image Viewer `viewer-control` zoom settings apply to images, not the Board.

Presentation works in both Interaction and Terminal modes. Interaction keeps chat mounted while opening the requested work-panel view. Unsaved edits defer presentation behind “결과 보기”; do not discard them. A subsequent presentation replaces highlights, and manual block selection clears them. Check the response: `delivered: 0` means no connected screen received the event; delivery alone does not prove the user saw the result. Do not repeatedly resend to force attention.

Choose the workflow from the user's intended outcome. Read only the relevant skill and references; do not load the whole collection.

| Request | Workflow |
| --- | --- |
| Create/name/select block-diagram tabs, implement/change blocks, wiring, descriptions, contracts, graph overview, or check graph/source consistency | [isp-block-development](../isp-block-development/SKILL.md) |
| “JOB 등록해”, split/merge work, implement block memos, process queued work | [isp-job-management](../isp-job-management/SKILL.md) |
| “리포트 발행해”, “시각화해”, compare or explain measured results | [isp-visualizations](../isp-visualizations/SKILL.md) → Visualizations |
| “뷰어에 띄워”, show RAW/BMP, inspect current view, zoom/pan/highlight, select crops | [isp-image-viewer](../isp-image-viewer/SKILL.md) → Image Viewer |
| Explicit Documentation / SDD / Software Development Document | [isp-documentation](../isp-documentation/SKILL.md) → Documentation |
| Create/update reusable project-specific skills or share skills alone | [project-skills.md](project-skills.md) → Project Skills |
| Track attempts, compare/restore checkpoints, inspect branches/tags/commits, share/open a `.bundle` | [isp-version-sharing](../isp-version-sharing/SKILL.md) |
| Runs 탭 실행 등록/수정/제거, expose script parameters, or reuse a project command | [execution-recipes.md](execution-recipes.md) |

An explicit destination overrides the defaults. A generic report is not automatically an SDD. “발행” here means a local registered report, not external publishing. An HTML report belongs in Visualizations because Image Viewer cannot display HTML. If both source inspection and a report are requested, use both tools and leave the user's last requested view in front.

For a selected-block question, use `context --selection`; for project purpose or entry points, use `graph-info` and [graph-overview.md](graph-overview.md). Do not edit anything merely to answer a context question.

Workflows compose only as needed: executing a substantial JOB may require block development, an attempt and a source checkpoint; registering a JOB alone requires none of those. A visualization can read code without changing it. Repeated experiments use [experiment-loop.md](experiment-loop.md) when requested, not an automatic background scheduler. Scratch work follows [temporary-files.md](temporary-files.md).

Current algorithms, entry points and decisions belong in graph overview/block metadata. Use [change-impact.md](change-impact.md) for affected records/evidence and [validation-method.md](validation-method.md) when selecting ISP checks. Reusable project-specific procedures belong in separately managed project skills; follow the judgment guidance in common.md. Existing links to `viewer.md`, `sdd.md`, `graph-overview.md`, `temporary-files.md`, and `experiment-loop.md` remain supported.

For per-block metadata storage and long explanations, follow [block-documents.md](block-documents.md). Agents may create relevant supporting Markdown documents in the block folder when needed.

For development Harness diagrams, execution, retries, run status and portable definitions, read [harness-workflows.md](harness-workflows.md). A Harness is an opt-in development procedure, separate from the target Pipeline.

## Role-specific working files

Organize block explanations, small reusable role-specific helper scripts and fixtures alongside the block in its diagram folder when useful. Keep product development in the existing source/test layout; do not move all work into the board. Follow [block-documents.md](block-documents.md) and discover the actual directory through block context.
