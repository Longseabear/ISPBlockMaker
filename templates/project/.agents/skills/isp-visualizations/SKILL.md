---
name: isp-visualizations
description: 시각화, 비주얼라이제이션, 리포트, 차트, 이미지 비교. Generate and register ISP reports, plots, comparisons and self-contained HTML in Visualizations. Use for 리포트 발행해, 시각화해 or 결과 비교; plain source-image viewing uses isp-image-viewer, and explicit SDD uses isp-documentation.
---

# Visualizations · 시각화와 결과 리포트

Read [shared rules](../isp-block-maker/common.md) once. A report/visualization request should produce a registered result in Visualizations, not only a chat explanation, file path or source opened in Image Viewer. Here “발행” means local registration, not external publication. Follow an explicitly requested destination; use [Image Viewer](../isp-image-viewer/SKILL.md) for source inspection and [Documentation](../isp-documentation/SKILL.md) only for explicit SDD requests.

Use [visualization methodology](../isp-block-maker/visualization-method.md) to choose evidence and presentation from the user's question. Read the relevant graph, code and outputs. Prefer an existing relevant generator; use [report-building.md](../isp-block-maker/report-building.md) for the reusable `report-build` renderer when images, lines, histograms or tables fit the question. Use [execution recipes](../isp-block-maker/execution-recipes.md) when a verified repeatable command is needed to produce data.

Use actual measurements and label illustrative examples/approximations. Follow [change-impact.md](../isp-block-maker/change-impact.md) for comparable conditions and source/evidence identity. Do not change the pipeline merely to make a report more attractive. Algorithm changes follow [block development](../isp-block-development/SKILL.md).

Write drafts under `tmp/<task-or-job-id>/`; put final output under durable `artifacts/generated/` before registering:

```text
artifact artifacts/generated/result.html --block BLOCK_ID --revision N --title "Comparison" --run RUN_ID
present --artifact ARTIFACT_ID --message "Comparison ready"
```

`--run` is optional and identifies an active attempt, not a recipe-run ID. Link returned artifact IDs in that attempt when applicable. Use a relevant existing block; a graph-wide report can be associated with its output/entry block without inventing a processing node. N is the revision captured when producing the result, not a newer value guessed after a conflict. Reconcile any intervening change and regenerate affected results as needed. Use the saved artifact ID from registration and verify returned state.

HTML must be self-contained: inline CSS/JS, embedded SVG/data images, no CDN or remote assets. It runs sandboxed without network or parent-app access. Supported image artifacts are PNG/JPEG/WebP; maximum file size is 10 MB. Inspect rendered output when tools permit and state any verification limitation. `demo` runs only the supplied synthetic grayscale example; it is not a generic graph executor or RAW/RTL validator and may not exist in a user's project.

Record a concise work summary and choose the final useful view through [completion.md](../isp-block-maker/completion.md). Registration/presentation failure is unfinished display, not success: fix it or state the specific saved/pending state. Preserve unsaved edits and terminal. If both a report and source inspection were requested, leave the user's last requested destination in front.
