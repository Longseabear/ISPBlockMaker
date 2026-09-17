---
name: isp-block-maker
description: Orient work in an ISP Block Maker project and choose the relevant local workflow when a task spans several tools or its destination is unclear. Use for project context, selected-block questions, and routing existing ISP Block Maker instructions.
---

# ISP Block Maker

Read [common.md](common.md) once for this project. These skills apply to the workspace containing this file and its subdirectories; they are not global instructions.

Choose the workflow from the user's intended outcome. Read only the relevant skill and references; do not load the whole collection.

| Request | Workflow |
| --- | --- |
| Implement/change blocks, wiring, descriptions, contracts, or graph overview | [isp-block-development](../isp-block-development/SKILL.md) |
| “JOB 등록해”, split/merge work, implement block memos, process queued work | [isp-job-management](../isp-job-management/SKILL.md) |
| “리포트 발행해”, “시각화해”, compare or explain measured results | [isp-visualizations](../isp-visualizations/SKILL.md) → Visualizations |
| “뷰어에 띄워”, show RAW/BMP, inspect current view, zoom/pan/highlight, select crops | [isp-image-viewer](../isp-image-viewer/SKILL.md) → Image Viewer |
| Explicit Documentation / SDD / Software Development Document | [isp-documentation](../isp-documentation/SKILL.md) → Documentation |
| Save a code version, inspect/switch a branch/tag/commit, share/open a `.bundle` | [isp-version-sharing](../isp-version-sharing/SKILL.md) |

An explicit destination overrides the defaults. A generic report is not automatically an SDD. “발행” here means a local registered report, not external publishing. An HTML report belongs in Visualizations because Image Viewer cannot display HTML. If both source inspection and a report are requested, use both tools and leave the user's last requested view in front.

For a selected-block question, use `context --selection`; for project purpose or entry points, use `graph-info` and [graph-overview.md](graph-overview.md). Do not edit anything merely to answer a context question.

Workflows compose only as needed: executing a JOB may require block development and its local commit; registering a JOB alone requires neither. A visualization can read code without changing it. Repeated experiments use [experiment-loop.md](experiment-loop.md) when requested, not an automatic background scheduler. Scratch work follows [temporary-files.md](temporary-files.md).

Project-specific algorithms, entry points and decisions belong in graph overview/block metadata, not in these reusable skill instructions. Existing links to `viewer.md`, `sdd.md`, `graph-overview.md`, `temporary-files.md`, and `experiment-loop.md` remain supported.
