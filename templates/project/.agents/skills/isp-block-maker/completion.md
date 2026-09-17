# Finish with useful evidence

After relevant validation and any required local commit, write one work-summary JSON in `tmp/<task-or-job-id>/` and call `summary FILE`. Include `title` and `summary`; useful optional fields are `reason`, `changes`, `validation`, `limitations`, verified `commit`, and actual `blockIds`, `jobIds`, `artifactIds` arrays. Explain outcome and evidence, not raw diffs. Stopped work should state what remains. This activity record does not complete JOBs; their lifecycle is separate.

Leave the user looking at the most useful result, unless they asked to keep their current view. Use actual saved IDs and choose one final view:

| Result | Presentation |
| --- | --- |
| Block/code/contract changes | `present --blocks ID,ID` (one block opens its inspector) |
| Changed surviving connections | `present --edges EDGE_ID,EDGE_ID`, optionally with `--blocks` |
| Useful new comparison/report | `present --artifact ARTIFACT_ID` |
| Deleted node/edge | Highlight surviving neighbors, or `present --graph` |
| Requested source image inspection | Follow Image Viewer acknowledgement workflow |
| Read-only or incomplete work | Usually retain the current view; show relevant existing evidence only if useful |

Add a short accurate `--message`. Edge highlighting includes both endpoint nodes and fits them together. Deleted IDs cannot be highlighted; mention the removal while showing survivors. Prefer a small relevant set. A later presentation replaces earlier highlights, and manual block selection clears them. Presenting a historical artifact does not make it current or rerun it.

`present` preserves terminal visibility/session and the terminal's pinned target. Unsaved inspector edits defer it behind “결과 보기”; never discard edits to force a view change. Inspect the response: `delivered: 0` means no connected screen received it, not that it was shown. Report the saved result and pending display accurately instead of repeatedly resending or launching a browser solely to force attention. Delivery does not mean the user saw it.

Finish with what changed, what was validated, and which result/block to inspect. Do not claim validation from metadata alone or dump project JSON into the response.
