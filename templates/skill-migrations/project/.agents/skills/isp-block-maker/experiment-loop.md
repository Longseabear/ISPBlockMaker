# Repeatable ISP experiment instructions

Use this protocol when the user asks for repeated experiments or to implement remaining JOBs. Stay inside the selected project and graph. Preserve the user's explicit scope and resource limits.

## Establish the experiment

1. Read `project`, `requests`, and `jobs` with the project CLI. The JOB Queue UI aggregates global and block work; do not restrict discovery to the terminal's pinned block. Keep a stable list of target IDs for this experiment.
2. Record a baseline: independent project Git commit and dirty state, exact implementation hash, graph revision, parameters, input identity/hash, shape/dtype/range, seed, boundary behavior, environment, metric definition and optimization direction. Do not silently change test data between candidates.
3. Choose a bounded protocol. Honor requested rounds/time/budget. If omitted, default to at most 5 candidate evaluations, one active run per project, and stop after 2 consecutive failures or 3 candidates without improvement. These defaults never authorize spending beyond existing tool permissions. Define acceptance/tolerance before tuning. If no quality metric is justified, report visual comparisons without claiming algorithmic improvement.
4. Convert plain user requests into small JOBs using `split-request` only when ready to act; preserve links to the source request. Do not invent new requirements or consume requests merely by reading them. Re-read JOBs before each round: skip deleted/completed tasks and respect user changes. Use `start-job` with the current revision.

## Execute one round at a time

- Change one hypothesis or a clearly specified candidate set. Implement only the selected graph, updating descriptions, contracts, implementation paths and entry symbols with actual behavior.
- Run relevant correctness checks before expensive evaluation. Compare each candidate to the same baseline and retain intermediate outputs needed to reproduce the comparison.
- Wait for the previous process to exit. Never send periodic keystrokes into a live interactive terminal. A failed or timed-out run is not a metric result; record the failure and honor the stopping rule. If a user decision is required, leave the JOB open and stop dependent work.
- Separate current candidate from best accepted candidate. A lower input/output difference is not necessarily better denoising. Do not label GPU speed or quality as improved without an appropriate reference and measurement.
- Save the run record under ignored `.isp/experiments/<run-id>/`: parameters, input identity, hashes, command, exit code, metric, acceptance decision, runtime and artifact IDs. Avoid including credentials or full session environment.
- Register visual results with `artifact` (or `registerArtifact` from the framework CLI) and metadata. Include project commit/dirty state, source hash, run ID, input/seed and parameters. Keep local run records out of Git.
- For accepted graph/code changes, follow the skill's local Git commit procedure, then re-read project/JOB and call `complete-job` with evidence and commit hash. If a candidate is rejected, preserve its result and describe the disposition; do not reset/stash unrelated work or claim the current file tree is the best version without verifying it. An analysis-only completed JOB does not require an empty commit.

## GPU simulator extensions

The GPU simulator loads project `extensions/gpu/*.json`. Each JSON has version 1, unique id, name, description, optional result blockId, a GLSL ES 3.00 fragment string and a parameters array. Each parameter defines a float uniform name, label, min/max/step/default and optionally blockId + parameter for explicit graph binding. The fixed vertex shader draws a full-screen triangle; use `gl_FragCoord` with `u_resolution` and sampler2D `u_image`. Declare an output vec4. Texture edges use clamp-to-edge; use explicit coordinate clamps for texelFetch.

GPU previews use RGBA8 input/output, with images bounded to 1024px. They are not automatic Python execution, RAW fidelity, or proof of CPU/GPU parity. Implement a corresponding shader only when its meaning is clear, label approximations, and compare representative inputs against the CPU reference with an explicit tolerance. Store the extension JSON alongside project code in Git. Do not modify framework sources to add a project algorithm.

Sliders only change preview values. Apply to the graph explicitly after evaluating the candidate; graph revision conflicts must be re-read rather than overwritten. Save useful GPU outputs to Visualizations with provenance. Report unsupported graph operations instead of silently omitting them.

## Finish and present

Stop when the request/JOB scope is exhausted, the target is met, or a bound is reached. Report rounds attempted, accepted/best candidate, baseline delta, failed/unfinished JOBs and exact commit/artifact references. For visual experiments, present the result artifact. For structural edits, highlight modified blocks and edges. Do not consume unresolved JOBs to make the queue look empty.

## Copyable user prompt

“선택한 프로젝트의 남은 JOB을 조회하고, 현재 구현을 기준으로 반복실험해줘. 입력과 seed를 고정하고 correctness 검증을 먼저 해. 최대 5회, 연속 실패 2회 또는 개선 없는 후보 3회에서 멈춰. 각 회차의 파라미터·소스 해시·지표·시각화를 남기고, 검증된 변경만 프로젝트 Git에 커밋해. 끝나면 최선 후보와 현재 적용 버전을 구분해서 보여줘. 품질 지표가 불명확하면 임의로 성공을 선언하지 마.”


GPU source-change tracking: extension JSON may include reference.shaderSha256 (SHA256 of the UTF-8 fragment string) and reference.sources [{path, sha256}] (project-relative source files, raw byte hashes). Include relevant implementation/helpers. This is a snapshot of named files, not a parity certification. Review CPU/GPU changes before refreshing both shader/source hashes; never auto-refresh only to hide a warning. Unrecorded or missing sources must not be described as synchronized.
