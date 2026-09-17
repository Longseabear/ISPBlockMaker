---
name: isp-visualizations
description: Generate and register ISP result reports, plots, image comparisons and self-contained HTML in the Visualizations tab. Use for 리포트 발행해, 시각화해 or 결과 비교; plain source-image viewing uses isp-image-viewer, and explicit SDD uses isp-documentation.
---

# Visualizations and local reports

Read [shared rules](../isp-block-maker/common.md) once. A report/visualization request should produce a registered result in Visualizations, not only a chat explanation, file path or source opened in Image Viewer. Here “발행” means local registration, not external publication. Follow an explicitly requested destination; use [Image Viewer](../isp-image-viewer/SKILL.md) for source inspection and [Documentation](../isp-documentation/SKILL.md) only for explicit SDD requests.

Read the relevant graph, code and outputs, then capture the project revision and source identity before producing the result. Choose the smallest visualization that answers the question: input/output/difference, distribution, mask coverage, a selected ROI/profile, or an interactive parameter comparison. Prefer updating an existing relevant generator to creating an unrelated dashboard.

Use actual measured outputs/validation. Label illustrative examples and approximations. Before/after needs both versions executed on the same input and stated parameters; otherwise show current-output validation. Record useful provenance: source commit plus dirty state/hash, graph revision, input/seed, parameters, metrics and limits. Do not change the pipeline merely to make a report more attractive. Algorithm changes follow [block development](../isp-block-development/SKILL.md).

Write drafts under `tmp/<task-or-job-id>/`; put final output under durable `artifacts/generated/` before registering:

```text
artifact artifacts/generated/result.html --block BLOCK_ID --revision N --title "Comparison" --run RUN_ID
present --artifact ARTIFACT_ID --message "Comparison ready"
```

`--run` is optional. Use a relevant existing block; a graph-wide report can be associated with its output/entry block without inventing a processing node. N is the revision captured when producing the result, not a newer value guessed after a conflict. Reconcile any intervening change and regenerate affected results as needed. Use the saved artifact ID from registration and verify returned state.

HTML must be self-contained: inline CSS/JS, embedded SVG/data images, no CDN or remote assets. It runs sandboxed without network or parent-app access. Supported image artifacts are PNG/JPEG/WebP; maximum file size is 10 MB. Inspect rendered output when tools permit and state any verification limitation. `demo` runs only the supplied synthetic grayscale example; it is not a generic graph executor or RAW/RTL validator and may not exist in a user's project.

Preserve historical registered files and version identity. Register a new artifact for current evidence rather than overwriting/relabeling an old one. Review affected generator formulas, controls, captions, legends, units and metrics together; a new title alone does not correct stale calculations.

Record a concise work summary and choose the final useful view through [completion.md](../isp-block-maker/completion.md). Registration/presentation failure is unfinished display, not success: fix it or state the specific saved/pending state. Preserve unsaved edits and terminal. If both a report and source inspection were requested, leave the user's last requested destination in front.
