# Agent bridge audit — 2026-11-24

## Findings and changes

- The MCP migration was incomplete: runtime prompts and multiple skills still directed supported operations through the CLI. Claude/Codex prompts, Harness prompts, managed workspace/source guidance, completion and recipe guides now prefer typed MCP operations. Existing custom guidance is preserved; only exact framework-generated sentences are upgraded. Added typed MCP operations for attempts/checkpoints/version previews and switches, user requests, JOB split/merge, skill CRUD, graph checks, harness definition import/export and recipe planning. Standalone archive and offline authoring utilities retain CLI entry points; the CLI is not removed.
- Added `get_workspace_info`, idempotent `record_work_summary`, and `get_runtime_diagnostics`. Existing `present_board`, `present_report` and `save_run_recipe` are the preferred paths. JSON files and Node subprocesses are unnecessary for these operations.
- CLI recipe CRUD previously fetched workspace info, then loaded the recipe runtime and wrote local files directly. It now calls the same authenticated server endpoints as MCP. Explicit recipe planning/execution retain their existing semantics.
- CLI block-schema loading is deferred to add-block, avoiding unnecessary schema startup for presentation and summaries. CLI imports remain inert; the workspace wrapper runs main exactly once.
- Summary persistence returns the record it saved instead of rereading the whole activity file. Report-only presentation uses the current in-memory state; graph presentation still refreshes graph files so external metadata changes remain visible. A presentation event is serialized once for all connected clients.
- Terminal writes now expose `outputCursorBeforeWrite`. Using the current output cursor in a write acknowledgement could skip output produced before that acknowledgement. A regression test reproduces fast output and verifies retry cursors. This is a possible lost-output mechanism, not proof of the reported remote echo timeout.
- Added `submit_shared_terminal_command`, which appends Enter to a single command line. Raw interactive input remains `write_shared_terminal`. Session metadata identifies the shell and last input/output times; acceptance explicitly says command completion is not tracked. Windows shells are cmd.exe, not PowerShell. SSH login/foreground tasks still require state-aware operation and user handoff.

## Measurements

Ran `node scripts/benchmark-agent-bridge.mjs` using Node v24.18.0 on Windows, an isolated temporary workspace, three sequential samples per operation. The benchmark starts its own server, uses real HTTP/MCP/CLI, writes only disposable benchmark records, and stops its server. It does not execute a recipe or SSH command. Samples exclude the initial server start and MCP handshake; CLI samples include each new process.

| Path / operation | Before (ms) | After (ms) |
| --- | --- | --- |
| MCP present | 31 / 30 / 14 | 34 / 24 / 30 |
| MCP summary | unavailable | 24 / 40 / 29 |
| MCP recipe save | 37 / 29 / 29 | 36 / 45 / 47 |
| CLI present | 261 / 291 / 263 | 145 / 128 / 129 |
| CLI summary | 284 / 268 / 254 | 119 / 118 / 115 |
| CLI recipe save | 270 / 282 / 267 | 122 / 135 / 140 |

These small samples show reduced CLI startup work and the benefit of choosing an existing MCP connection. They do not show an MCP server speedup or reproduce the reported 30–120 second delays. They are not measurements of the other PC, a large project, OneDrive hydration, security scanning, the model's scheduling delay or browser rendering.

## Diagnosing the affected machine

1. Use `get_runtime_diagnostics` (CLI fallback: `isp diagnostics`). Request totals and the last 100 timing records distinguish tool duration and API processing. Event-loop mean/max/p99 expose server stalls. Data is memory-only, bounded, and cleared on restart. It contains route templates/tool names and durations, not credentials, bodies, terminal output or query strings.
2. For a necessary CLI fallback, set `ISP_TIMING=1` in that process environment. stderr reports connection-resolution time, request time, the server's `Server-Timing` value, and process uptime. stdout remains the normal JSON. Compare the caller's wall-clock duration as well: process uptime does not include time before the OS starts the process or after it exits.
3. If server timing is short but the agent observes minutes, inspect its tool queue, shell startup/permission waiting, retries and client transport. If server/tool time or event-loop stalls are long, inspect the actual workload and filesystem on that PC. Do not repeatedly resend mutations with new IDs.
4. For a quiet terminal, inspect ownership, shell, last input/output time and output from `outputCursorBeforeWrite`. A running PTY is not proof of a responsive prompt or completed command. Do not send an echo into a password prompt or a foreground server. No automatic Ctrl+C, process kill, host-key acceptance or ownership takeover is performed.

Remaining architecture: MCP uses the persistent client connection plus an in-process local HTTP adapter. Some graph, activity and recipe storage paths remain synchronous; large or slow filesystems can still block the server. The adapter was retained to preserve existing validation/authentication and avoid an unmeasured service-layer rewrite. Diagnostics are intended to locate an actual stall before further optimization.

After installing this build, restart the workspace server and reconnect external MCP clients once so they discover the new catalogue and session identity. Existing chat context may still contain older instructions; use a new chat when it keeps following those instructions. Managed skills update when the workspace opens; customized skills are preserved with the normal update-candidate workflow.
