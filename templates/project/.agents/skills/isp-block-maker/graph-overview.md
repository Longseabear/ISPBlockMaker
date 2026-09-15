# Whole-graph context

Read `isp graph-info` (also `project.overview` or `context.overview`) before implementing or explaining the pipeline. Check the real source before relying on old notes.

The versioned `graph.json` has `overview`:
- `description`: short human-facing purpose, overall input and output.
- `detail`: human-facing processing flow, important decisions, limitations and practical interpretation. Freeform prose is welcome.
- `entryPoint`: verified workspace-relative source paths and symbols, how to run the pipeline, required inputs and relevant setup. Distinguish production entry points from demos/tests.
- `agentNotes`: flexible agent-oriented context, invariants, dependencies, known gaps and useful validation commands. Use English, equations, structured notes or another clear format that helps accurate work. Do not record hidden reasoning, credentials or invented facts.

Update affected overview fields when graph purpose, composition, entry points or important constraints change. If missing, derive a concise overview from inspected code within the authorized task. Keep unknowns explicit. Preserve unrelated user notes; do not replace useful context with a chronological work log. Requests and JOBs remain in globalWork, and execution summaries belong in activity records.

Write a partial object with only changed overview fields to `tmp/<task-or-job-id>/overview.json`, then run:

```text
isp graph-info
isp graph-info tmp/<task-or-job-id>/overview.json --revision N
```

The update merges supplied fields and rejects stale revisions. Re-read on conflict, reconcile edits and retry with the current revision. Empty strings explicitly clear fields. API equivalent: PATCH /api/global with {"revision":N,"patch":{"overview":{"entryPoint":"pipeline.py:run"}}}. Read the saved overview back and commit it with related graph/code changes. Whole-graph context supplements, rather than duplicates, block contracts.
