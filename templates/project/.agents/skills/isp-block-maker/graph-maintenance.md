# Graph knowledge maintenance

The graph should let a new reader understand and reproduce the current pipeline without reconstructing the conversation. Inspect the actual implementation and relevant evidence first. Treat graph metadata as a maintained specification, not proof that code is correct.

## When to reconcile

Read the overview and affected block contracts at task entry. Use [change-impact.md](change-impact.md) at relevant implementation/validation milestones and handoff/completion to select the affected records and checks. Reconcile verified in-scope facts only; report unrelated discrepancies without silently changing them.

## Where knowledge belongs

| Knowledge | Location |
| --- | --- |
| Project purpose, overall I/O, processing order and important boundaries | overview.description / overview.detail |
| Actual run command, working directory, source symbol, setup and input prerequisites | overview.entryPoint |
| Cross-block invariants, dependencies, limitations and unresolved questions | overview.agentNotes |
| One node's role and result, readable on the canvas | block.description, normally 1–2 sentences |
| Human explanation of transformation, parameter effects, rationale and failure cases | block.detail |
| Implementation method, precise I/O and numerical/state contracts | block.principle / block.agentContract |
| Actual implementation path and function/class | block.implementation / implementationSymbol |
| Reusable parameterized invocation and expected outputs | Execution recipe; reference its ID from overview.entryPoint or a relevant Project Skill |
| Reusable how-to procedure spanning future tasks | Project Skills; reference its name from graph notes if relevant |
| Run-specific measurements, attempts and historical results | Activity/attempt/artifact records; link IDs from relevant notes only when useful |

Start with I/O: what each port carries, producer/consumer, shape, dtype, layout, unit/range, valid regions and state. For ISP, add CFA order/group, bit depth/container/alignment, black/white level handling, boundary policy, precision, rounding and clipping only where relevant and verified. Describe a transformation in enough detail to distinguish it from plausible alternatives. Explain shared implementations and non-1:1 C-model mappings explicitly. Do not add meaningless fields to every node.

Keep edges and ports consistent with real stage flow; annotate coordinate conversions, scale changes, state dependencies or domain transitions in affected contracts. Do not add processing nodes for reports, JOBs or ordinary helper functions. Do not change topology merely to enrich documentation.

## Write, verify, present

Use partial CLI patches with the inspected revision; preserve user notes and stable IDs. Structured string fields are organizational aids: clear prose, equations, pseudocode and freeform notes are welcome. Keep unknowns and validation limits visible. Store no secrets, private reasoning, raw image arrays, or copied logs.

Follow [change-impact.md](change-impact.md) for read-back, evidence identity and coherent checkpoints, then [completion.md](completion.md) for presentation. Mention meaningful graph knowledge changes or concrete unresolved mismatches; no repeated no-change message is required.
