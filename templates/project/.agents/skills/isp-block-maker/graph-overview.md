# Whole-graph context

Use `isp graph-info` or `context.overview` when the task benefits from a big-picture description of the selected diagram. It is not required before every code edit. Check the real source before relying on old notes.

The versioned `graph.json` stores a per-diagram `overview` in `diagrams`; the top-level overview holds project-common context:
- `description`: short human-facing purpose, overall input and output.
- `detail`: human-facing processing flow, important decisions, limitations and practical interpretation. Freeform prose is welcome.
- `entryPoint`: verified source-root-relative paths and symbols, how to run from `sourceRoot`, required inputs and relevant setup. Reference an existing [execution recipe](execution-recipes.md) by ID when it supplies the reusable invocation. Discover directories with `workspace-info`; input data may be outside the source repository. Distinguish production entry points from demos/tests.
- `agentNotes`: flexible agent-oriented context, invariants, dependencies, known gaps and useful validation commands. Use English, equations, structured notes or another clear format that helps accurate work. Do not record hidden reasoning, credentials or invented facts.

Update affected overview fields when graph purpose, composition, entry points or important constraints change. If the task needs a missing overview, derive a concise description from inspected code; do not fill it as an unrelated prerequisite. Keep unknowns explicit. Preserve unrelated user notes; do not replace useful context with a chronological work log. Requests and JOBs remain in globalWork, and execution summaries belong in activity records.

Write a partial object with only changed overview fields to `tmp/<task-or-job-id>/overview.json`, then run:

```text
isp graph-info
isp graph-info tmp/<task-or-job-id>/overview.json --revision N
```

Read the current overview and preserve its other fields in the submitted object; stale revisions are rejected. Re-read on conflict, reconcile edits and retry with the current revision. Empty strings explicitly clear fields. API equivalent: PATCH /api/diagrams/ID with {"revision":N,"patch":{"overview":COMPLETE_OVERVIEW}}. Use --diagram ID to pin the CLI target. Read the saved overview back and checkpoint it with related graph/code changes. Whole-graph context supplements, rather than duplicates, block contracts.

Use [graph-maintenance.md](graph-maintenance.md) for information placement and [change-impact.md](change-impact.md) for milestone checks. Make the overview sufficient to identify the current pipeline and how to run it, not merely its name.
