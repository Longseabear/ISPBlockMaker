# Repeatable ISP experiment instructions

Use this protocol when the user asks for repeated experiments or to implement remaining JOBs. Stay inside the selected project and graph. Preserve the user's explicit scope and resource limits.

Read [common.md](common.md) once. Use [job management](../isp-job-management/SKILL.md) for actual requests/JOBs, [block development](../isp-block-development/SKILL.md) when changing algorithms, and [attempt tracking](../isp-version-sharing/work-tracking.md) for durable experiment records. Discover source/data/tmp roots with `workspace-info`; keep scratch scripts/images under `tmpDir`. This protocol is not an automatic scheduler.

## Establish the experiment

1. Read `project`, `requests`, and `jobs` with the project CLI. The JOB Queue UI aggregates global and block work; do not restrict discovery to the terminal's pinned block. Keep a stable list of target IDs for this experiment.
2. Record the baseline and comparable conditions using [change-impact.md](change-impact.md): source checkpoint, graph revision, inputs, parameters, relevant environment and metric definition/direction. Reuse verified values from a run manifest when available. Do not silently change test data between candidates.
3. Choose a bounded protocol. Honor requested rounds/time/budget. If omitted, default to at most 5 candidate evaluations, one active run per project, and stop after 2 consecutive failures or 3 candidates without improvement. These defaults never authorize spending beyond existing tool permissions. Define acceptance/tolerance before tuning. If no quality metric is justified, report visual comparisons without claiming algorithmic improvement.
4. Convert plain user requests into small JOBs using `split-request` only when ready to act; preserve links to the source request. Do not invent new requirements or consume requests merely by reading them. Re-read JOBs before each round: skip deleted/completed tasks and respect user changes. Use `start-job` with the current revision.

## Execute one round at a time

- Start a distinct attempt for each hypothesis or clearly specified candidate set, linking its scoped JOBs and actual baseline checkpoint. Implement only the selected graph, updating descriptions, contracts, source-relative implementation paths and entry symbols with actual behavior.
- Choose relevant correctness checks with [validation-method.md](validation-method.md) and run them before expensive evaluation. Compare each candidate to the same baseline and retain intermediate outputs needed to reproduce the comparison. Use an existing [execution recipe](execution-recipes.md) when suitable; a recipe-run ID is separate from the attempt ID.
- Wait for the previous process to exit. Never send periodic keystrokes into a live interactive terminal. A failed or timed-out run is not a metric result; record the failure and honor the stopping rule. If a user decision is required, leave the JOB open and stop dependent work.
- Separate current candidate, best measured candidate and user-accepted candidate. Passing the experiment's criteria does not set the UI's accepted marker or create a tag. A lower input/output difference is not necessarily better denoising. Do not label GPU speed or quality as improved without an appropriate reference and measurement.
- Save a candidate checkpoint before evaluation when practical; record parameters, input identity, hashes, command, exit code, measured metric and runtime through the attempt's `inputConditions`, `validation` and `summary`. Avoid credentials/full session environments. Use the tracking API instead of directly writing `.isp/` records.
- Register visual results with `artifact` and `--run ATTEMPT_ID`; include tested checkpoint/source hash, input/seed and parameters in available provenance. Link actual artifact IDs to the attempt. Keep outputs at workspace level outside the source repository.
- Finish each attempt with the explicit tested `resultCheckpointId`. If a candidate is rejected, preserve its snapshot/result and describe the outcome. Do not reset/stash unrelated work or automatically restore to an older candidate. When the JOB's acceptance criteria are satisfied, re-read it and call `complete-job` with evidence and attempt/checkpoint IDs. An analysis-only completed JOB does not require an artificial code edit or normal Git commit.

## GPU simulator extensions

The GPU simulator loads `extensions/gpu/*.json` relative to `sourceRoot`. Each JSON has version 1, unique id, name, description, optional result blockId, a GLSL ES 3.00 fragment string and a parameters array. Each parameter defines a float uniform name, label, min/max/step/default and optionally blockId + parameter for explicit graph binding. The fixed vertex shader draws a full-screen triangle; use `gl_FragCoord` with `u_resolution` and sampler2D `u_image`. Declare an output vec4. Texture edges use clamp-to-edge; use explicit coordinate clamps for texelFetch.

GPU previews use RGBA8 input/output, with images bounded to 1024px. They are not automatic Python execution, RAW fidelity, or proof of CPU/GPU parity. Implement a corresponding shader only when its meaning is clear, label approximations, and compare representative inputs against the CPU reference with an explicit tolerance. Store the extension JSON alongside project code in Git. Do not modify framework sources to add a project algorithm.

Sliders only change preview values. Apply to the graph explicitly after evaluating the candidate; graph revision conflicts must be re-read rather than overwritten. Save useful GPU outputs to Visualizations with provenance. Report unsupported graph operations instead of silently omitting them.

## Finish and present

Stop when the request/JOB scope is exhausted, the target is met, or a bound is reached. Report rounds attempted, best measured candidate, any user-accepted candidate, baseline delta, failed/unfinished JOBs and exact attempt/checkpoint/artifact references. Distinguish currently applied source from the result being shown. Follow [completion.md](completion.md): for visual experiments present the result artifact; for structural edits highlight modified blocks and edges. Do not consume unresolved JOBs to make the queue look empty.

## Copyable user prompt

“선택한 프로젝트의 남은 JOB을 조회하고, 현재 구현을 기준으로 반복실험해줘. 입력과 seed를 고정하고 correctness 검증을 먼저 해. 최대 5회, 연속 실패 2회 또는 개선 없는 후보 3회에서 멈춰. 각 회차를 시도로 기록하고 파라미터·소스 체크포인트·지표·시각화를 연결해줘. 끝나면 최선 후보와 현재 적용 버전을 구분해서 보여줘. 채택과 태그는 내가 선택할게. 품질 지표가 불명확하면 임의로 성공을 선언하지 마.”


GPU source-change tracking: extension JSON may include reference.shaderSha256 (SHA256 of the UTF-8 fragment string) and reference.sources [{path, sha256}] (source-root-relative files, raw byte hashes). Include relevant implementation/helpers. This is a snapshot of named files, not a parity certification. Review CPU/GPU changes before refreshing both shader/source hashes; never auto-refresh only to hide a warning. Unrecorded or missing sources must not be described as synchronized.
