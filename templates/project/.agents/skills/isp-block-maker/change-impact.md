# Change impact and evidence

Use this reference for graph-related implementation or analysis at meaningful milestones and completion. Inspect actual code and evidence before changing claims. Update only information affected by the authorized task; unchanged metadata needs no write. A read-only explanation, queue edit or failed experiment does not authorize graph redesign.

| Change | Reconcile | Useful verification |
| --- | --- | --- |
| Processing behavior or parameters | Actual method/assumptions in affected human detail and agent contracts; downstream implications; related generator formulas, controls, units, metrics and SDD claims made inaccurate by the change | Execute relevant checks chosen with [validation-method.md](validation-method.md); compare to a reference only when justified |
| Ports, topology, source file or symbol | Real flow, neighboring I/O contracts, shared implementations and overview entry points | Run `graph-check` for the affected scope, then inspect the actual composition and contracts it cannot prove |
| Explanation or metadata only | Verified facts, concise card text and useful existing user notes | Read back saved context and resolve changed references; no artificial experiment |
| Report or visualization | Measurement domains, rendering transforms, labels and source/run identity | Inspect rendered output and confirm its claims follow from measured data |

When scope crosses categories, use the relevant rows rather than a mandatory checklist for every block. Preserve stable IDs; rename misleading display names when affected. Label proposed behavior and unverified assumptions explicitly. Use [graph-maintenance.md](graph-maintenance.md) for information placement.

## Read-only graph check

```text
graph-check
graph-check --block BLOCK_ID
graph-check --changed blocks/filter.py,helpers/numerics.py
```

Changed paths are relative to `sourceRoot`. Use actual edited paths; the command does not infer a Git diff. `--block` scopes source/metadata inspection while structural graph checks remain global. `--changed` maps paths to all referencing blocks, including shared-file users outside that block scope.

Read `findings`, `impact`, `scope` and `limitations` in the response. A `check` records a limited verified fact, `error` a structural/file problem, `warning` an unresolved reference or review need, and `info` missing context or unsupported inspection. Source-symbol checks use lightweight Python/JS/TS declaration scanning; unsupported languages and ambiguous symbols require review. Reads are bounded. The result is not a graph executor or proof of numerical behavior, prose contracts or CPU/GPU equivalence. Review downstream effects beyond a reported scope when the change requires it; do not repair unrelated findings automatically.

## Evidence identity

Before/after requires both implementations executed on comparable inputs, parameters, regions and measurement domains; otherwise label current-output validation. Retain enough conditions to reproduce the claim: executed source/checkpoint and dirty state, graph revision, inputs, parameters, seed and relevant environment/limits. An [execution recipe](execution-recipes.md) records a run manifest and logs; reuse those verified values instead of retyping them. A manifest or zero exit status does not establish algorithm correctness.

Preserve historical registered files and identity. Register a new current result through [Visualizations](../isp-visualizations/SKILL.md). If source changed after execution, use the tested source identity or rerun the affected check; do not assign old outputs to a new checkpoint. Updating a caption or hash does not repair stale formulas.

After metadata writes, read back affected contexts/overview and check source references and neighboring contracts. Save coherent source, graph and generator changes with the [version workflow](../isp-version-sharing/SKILL.md), linking the tested checkpoint to an existing attempt where applicable. Keep required unfinished JOB checks open. State concrete validation limits, then use [completion.md](completion.md) for summary and presentation.
