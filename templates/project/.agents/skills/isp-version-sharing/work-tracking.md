# Attempts and reproducible checkpoints

Use this reference for substantial algorithm/JOB work, repeated experiments, or requested work history. A JOB records intent, an attempt records one approach and evidence, and a checkpoint stores the whole graph/code snapshot. Tags remain user-designated completed versions. None of these replaces actual validation.

## Start from the actual source

Read `workspace-info`, `project`, relevant scoped JOBs and source diffs. Put command JSON in a task directory under the discovered `tmpDir`; examples below assume its absolute path. Start only the work authorized by the user. Creating a pending JOB alone does not start an attempt.

```text
attempts
attempt-start "<tmpDir>/denoise/start.json"
```

Example start JSON (omit or replace fields that are not applicable; use real IDs):

```json
{
  "title": "Evaluate max-min flat detection",
  "approach": "Replace the estimator within the existing graph and compare edge preservation.",
  "jobRefs": [{"blockId": "flat-detection", "jobId": "ACTUAL_JOB_ID"}],
  "blockIds": ["flat-detection"],
  "inputConditions": "Actual input identity/hash, dimensions, numeric format, parameters, seed and run command."
}
```

Use `blockId: null` in `jobRefs` for a global JOB. Scope is part of the reference; identical-looking IDs must not be guessed. No JOB is required for a direct algorithm request. `baselineCheckpointId` can name an existing checkpoint; when omitted, starting the attempt captures the current source, including current nonignored changes, without altering HEAD/staging. Save the returned attempt/baseline IDs. This records where work started, not a claim that its baseline was tested or that all captured edits are yours.

## Record measured work

Update an active attempt with `attempt-update ATTEMPT_ID FILE.json`. Fields include `title`, `approach`, `inputConditions`, `summary`, `validation` (strings), `artifactIds`, `resultCheckpointId`, and `status` (`in_progress`, `completed`, `failed`, `cancelled`). Record actual input identity, parameters, seed, command and relevant environment in `inputConditions`; use `validation` for checks and measured metrics with units, reference and direction. Do not invent success/quality from a zero exit code or an input/output difference metric.

Preserve reproducible source identity before generating evidence when practical:

```text
checkpoint --title "Max-min candidate for evaluation"
```

Retain that checkpoint ID and verify graph/code remain equivalent while running. Save useful visual evidence with the normal `artifact` command, using `--run ATTEMPT_ID`, then link the returned artifact IDs. A historical artifact is a link, not automatic proof of source equivalence. If code changed after execution, pass the tested checkpoint explicitly; only rerunning the final source justifies attaching new-source evidence.

Example completion JSON:

```json
{
  "status": "completed",
  "summary": "Describe the observed outcome and remaining limitations.",
  "validation": ["Actual test command and result", "Measured metric, units and comparison conditions"],
  "artifactIds": ["ACTUAL_ARTIFACT_ID"],
  "resultCheckpointId": "ACTUAL_TESTED_CHECKPOINT_ID"
}
```

Completing without an explicit result checkpoint captures current source automatically. Use that only when it is the source actually evaluated. Terminal attempts are immutable, so reconcile final evidence before completing; start another attempt for a new approach instead of rewriting history. For failed/cancelled work, supply a result checkpoint if the failed source needs to be retained, and leave unfinished JOBs open. An attempt's completion does not automatically complete linked JOBs, and a successful experiment does not authorize adopting the candidate.

## Compare, adopt, restore

```text
checkpoints
checkpoint-compare BASELINE_ID RESULT_ID
checkpoint-preview CHECKPOINT_ID
```

Comparison is read-only. The preview returns a `snapshot` guard for the current graph/source/index/HEAD. Only when the user requests restoration, run `checkpoint-restore CHECKPOINT_ID --snapshot VALUE` using that exact fresh guard. Re-preview/reconcile if it is stale; never bypass it. Restore preserves the prior current state in a safety checkpoint and applies the full source graph/code snapshot, stopping attached terminals. JOBs, attempts and artifacts remain local history. Refresh context after restoring. Do not promise per-node restore or restore merely to show a result.

`attempt-accept ATTEMPT_ID` marks the user's chosen completed attempt with a result checkpoint; it neither restores source nor creates a Git tag. Use it when the user asks to adopt/choose that attempt, not automatically for passing tests or the agent's preferred metric. To answer "which version am I seeing?", distinguish current source, displayed artifact and accepted attempt. A requested restore and an explicit adoption may be combined, but neither implies the other.
