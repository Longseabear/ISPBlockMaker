---
name: isp-block-development
description: Implement or edit ISP graph blocks, connections, code entry points, human descriptions and agent contracts. Use for algorithm changes, code-to-node mapping, input/output explanations, or whole-graph context; combine with job management only when requests or JOBs are involved.
---

# Develop the graph

Read [shared rules](../isp-block-maker/common.md) once. Read `graph-info`, the relevant block contexts, and their actual source before editing. For pipeline purpose, entry points or graph-wide notes, use [graph-overview.md](../isp-block-maker/graph-overview.md). Read [version rules](../isp-version-sharing/SKILL.md) before changing versioned files so existing user changes remain identifiable.

## Implementation boundary

Implement the requested graph blocks and connections. Each processing stage belongs to a node and inter-block flow to ports/edges. Do not introduce hidden stages, bypass connections, or expand a block task into framework UI/services/infrastructure. Represent a necessary new stage or edge when it falls within the authorized change; otherwise explain the graph gap and leave that portion pending.

Prefer functions with explicit inputs, parameters, outputs and state, composed according to the graph. Helpers, shared math and minimal adapters may support the blocks without adding pipeline behavior. This is flexible: classes, streaming buffers, hardware interfaces or performance-oriented structures are appropriate when needed. Record their entry point, state lifecycle, side effects and reason. Several nodes may share a source file, but their operations must be identifiable; do not disguise a monolithic operation by adding labels. Tests, fixtures and requested visualizations may support implementation without changing the production data path.

## Three audiences, input/output first

| Field | Content |
| --- | --- |
| `description` | Graph card only: usually 1–2 short sentences identifying role/output; no derivations, stable-ID notes or long examples |
| `detail` (`human.detail`) | Human-facing behavior, rationale, parameter effects, examples and limitations, normally in the user's language |
| `principle`, `agentContract` | Precise implementation/validation knowledge for another agent; use suitable English, equations, pseudocode, symbols or structured notes |

Explain `agentContract.inputs` and `.outputs` using actual port IDs: meaning, producer/consumer, shape, layout, units/range, assumptions, guarantees and useful examples. A source/sink can explicitly have no inputs/outputs. Canonical ports, parameters and connections stay in shared graph fields.

Structured contract fields include `dataFormat`, `boundaries`, `numerics`, `steps`, `validation`, and `acceptance`; they are organizational aids, not a limit. Use `agentContract.notes` freely for rationale, tradeoffs, dependencies, cross-block relationships, open questions and implementation hints. Prefer precise maintainable facts over verbose repetition or opaque shorthand; no language guarantees better performance. Do not invent missing facts or store hidden reasoning/secrets.

On authorized edits, move excessive card text into `detail` without losing knowledge and keep all audiences accurate. Do not rewrite unrelated blocks merely to populate empty fields. Preserve useful existing agent knowledge.

## Graph commands

Write JSON under `tmp/<task-or-job-id>/`, using the inspected revision N:

```text
add-block block.json --revision N
update patch.json --block ID --revision N
delete-block ID --revision N [--with-edges]
connect SOURCE:PORT TARGET:PORT --revision N --id EDGE_ID
disconnect EDGE_ID --revision N
mermaid
```

`add-block` takes a block object with stable `id` and `name`; omitted text/ports are empty, status defaults to `draft`, position to `(300,300)`. A port is `{"id":"image","name":"Image","type":"image"}`; types are `image`, `mask`, `signal`. `update` accepts a partial block object; read an existing block for the current schema. Preserve requests/JOBs and unrelated metadata.

Set workspace-relative `implementation` and actual `implementationSymbol` (for example `flat_detection` or `Denoiser.process`). The code viewer jumps to this function/class, especially for shared files. Rename/move references with the code; an absent/ambiguous symbol leaves the viewer at the top. The fallback converts block-ID hyphens to underscores, but explicit accurate metadata is preferable.

Connected-node deletion requires `--with-edges` and removes incident edges atomically; use it only when disconnecting is part of the request. Source files and historical artifacts remain. The final node cannot be deleted. Cycles, incompatible port types and multiple drivers for one input are rejected. `mermaid` exports the graph; JSON remains the specification.

## Keep code, explanations and evidence aligned

Code changes alone are not completion, even without a JOB:

- Update affected card text, human detail, agent principle/contract, ports, parameters and source symbols. Rename a misleading display name while preserving its stable ID. Inspect downstream consumers and nodes sharing changed code; update only affected information.
- For example, replacing mean/mean-square variance with min/max must describe the actual estimator, such as `(max-min)^2/12` if implemented, its approximation and threshold implications. An old ID does not justify an obsolete formula.
- Inspect related visualization generators, controls, captions, legends, units, metrics, SDD descriptions and alternate references. Update tools made inaccurate by the change, including executable formulas. Refreshing a title/hash alone does not prove equivalence.
- For behavior changes, produce useful evidence from actual execution where feasible. Prefer improving a relevant existing tool and the smallest useful output: input/output/difference, estimator distribution/mask coverage, or ROI/profile. Use [Visualizations](../isp-visualizations/SKILL.md) to register it. Do not create every chart or invent a dashboard for a minor edit.
- A before/after comparison requires both versions run on the same input and stated parameters; otherwise label current-output validation. Preserve historical registered files/version identity and register a new current result. Record input/seed/hash, parameters, source version plus dirty state, graph revision, and verification limits as appropriate.
- Re-read saved context, check code composition against ports/edges/contracts, and inspect the result. Required unfinished checks/metadata updates keep the relevant JOB open. If useful visual evidence cannot be produced, state the concrete limitation and actual validation. Spelling/layout edits or behavior-preserving refactors need appropriate checks, not an artificial experiment.

Save coherent graph/source/generator changes through the [local commit workflow](../isp-version-sharing/SKILL.md), then follow [completion.md](../isp-block-maker/completion.md). Prefer a new useful comparison for final presentation; otherwise highlight changed blocks and surviving edges. If work originated in requests/JOBs, finish its lifecycle through [job management](../isp-job-management/SKILL.md). For requested optimization/iteration, additionally read [experiment-loop.md](../isp-block-maker/experiment-loop.md).
