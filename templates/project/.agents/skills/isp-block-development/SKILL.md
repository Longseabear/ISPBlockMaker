---
name: isp-block-development
description: Implement or edit ISP graph blocks, connections, code entry points, human descriptions and agent contracts. Use for algorithm changes, graph/source consistency checks, code-to-node mapping, input/output explanations, or whole-graph context; combine with job management only when requests or JOBs are involved.
---

# Develop the graph

Read [shared rules](../isp-block-maker/common.md) once. Use `workspace-info` to resolve paths when needed. Consult `graph-info` and relevant block contexts when they help understand the requested structure or scope; inspect actual source before editing it. Board lookup is not mandatory for every implementation task. For pipeline purpose, entry points or graph-wide notes, use [graph-overview.md](../isp-block-maker/graph-overview.md). Read [version rules](../isp-version-sharing/SKILL.md) before changing versioned files so existing user changes remain identifiable. For substantial algorithm/JOB work, follow [attempt tracking](../isp-version-sharing/work-tracking.md) to retain the starting implementation, execution conditions and resulting checkpoint; a spelling fix needs no artificial experiment.

## Implementation boundary

Implement the requested graph blocks and connections. Use nodes for major conceptual processing stages and edges for meaningful data flow. A node may summarize several functions or internal steps. Do not expand the board for every helper, refactor, experiment or incidental code detail. When an authorized change alters the major processing flow, update the affected nodes/connections; otherwise leave the topology alone. Do not expand a block task into unrelated framework work.

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

## Block folders and longer explanations

Read [block-documents.md](../isp-block-maker/block-documents.md) when creating or updating block explanations, design notes or long technical documentation. Create useful supporting documents autonomously within the requested block scope; do not wait for a separate documentation request when the implementation needs a durable explanation.

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

Set `implementation` relative to the discovered `sourceRoot` and actual `implementationSymbol` (for example `flat_detection` or `Denoiser.process`). The code viewer jumps to this function/class, especially for shared files. Rename/move references with the code; an absent/ambiguous symbol leaves the viewer at the top. The fallback converts block-ID hyphens to underscores, but explicit accurate metadata is preferable.

Connected-node deletion requires `--with-edges` and removes incident edges atomically; use it only when disconnecting is part of the request. Source files and historical artifacts remain. The project must retain at least one node overall; an individual diagram may be empty. Pipeline cycles, incompatible port types and multiple drivers for one pipeline input are rejected. Harness diagrams instead use Pass/Fail control connections and bounded cycles; follow the harness workflow guide. `mermaid` exports the graph; JSON remains the specification.

## Validate and reconcile the change

Use [change-impact.md](../isp-block-maker/change-impact.md) to select affected metadata, source checks and evidence. `graph-check [--block ID] [--changed FILE,FILE]` provides read-only structural/reference findings and shared-file impact; it does not establish algorithm correctness.


Follow [completion.md](../isp-block-maker/completion.md) for the coherent checkpoint, work summary and useful final view. If work originated in requests/JOBs, finish its lifecycle through [job management](../isp-job-management/SKILL.md). For requested optimization/iteration, additionally read [experiment-loop.md](../isp-block-maker/experiment-loop.md).


## Multiple named diagrams (C-model / Floating model)

A project can contain several independent diagrams. Run `diagrams` to discover IDs/names and selectedDiagramId. `project`, `graph-info`, and `mermaid` default to the selected diagram; add `--diagram ID` for a stable explicit target. `project --all-diagrams` returns the complete project. When the task needs board context, read the selected diagram and keep its ID fixed for subsequent mutations even if the user switches tabs.

- `diagram-add FILE.json --revision N`: create and select `{ "id":"floating", "name":"Floating model", "overview":{...} }`; starts empty.
- `diagram-select ID`: choose the default diagram without changing source revision.
- `diagram-update ID FILE.json --revision N`: rename and/or change overview. Preserve the stable ID.
- `diagram-delete ID --revision N`: remove an empty diagram; the final diagram cannot be removed.
- `add-block`, `delete-block`, `connect`, `disconnect` accept `--diagram ID`. Otherwise they use the selected diagram. A new block is registered in that diagram; explicit block JSON diagramId must match.
- `update --block ID` is an explicit globally unique block target. Moving a block requires updating diagramId and reconciling its connections; cross-diagram edges are rejected.
- `graph-info patch.json --revision N --diagram ID` updates that diagram's overview.

Canonical graph.json stores diagrams {id,name,overview} and blocks with diagramId; edges remain between block IDs and cannot cross diagrams. Block and edge IDs are project-global: prefix model-specific blocks (e.g. c-input, float-input) to avoid ambiguity in jobs/artifacts/source references. Existing single graphs load as Main without regenerating IDs. Empty diagrams are valid, but the project retains at least one block overall.

JOBs and requests remain in the project-wide queue, not inside diagram definitions. Use --global for cross-model work; existing block-linked JOBs remain visible in the global queue across tabs. Switching diagrams does not create or complete JOBs. Present one diagram's blocks/edges at a time. Source code and artifacts remain shared project resources.
