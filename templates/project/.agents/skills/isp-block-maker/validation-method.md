# Select ISP validation from the claim

Use this when changing processing behavior, checking a block contract or evaluating an implementation. Select checks that can distinguish the requested behavior from a plausible wrong implementation; there is no universal suite or mandatory figure count.

1. Identify the guarantee affected by the change and its measurement domain. Read actual I/O, units, layout, valid regions, state and downstream assumptions. Separate sensor values from display-transformed previews.
2. Choose an appropriate oracle: an existing trusted implementation, an independently derived small case, an invariant, or a relationship between controlled inputs and outputs. Existing useful tests take priority over building a new harness. State which property the evidence establishes and what remains untested.
3. Select a small set of cases that exercises the changed guarantee and credible failure modes. Use synthetic inputs for interpretable properties and representative data for behavior that synthetic cases cannot establish. Define any justified acceptance tolerance and metric direction before evaluating candidates.
4. Execute from a verified graph entry point, relevant project skill or [execution recipe](execution-recipes.md). Preserve input identity and conditions. A process completing successfully proves execution; inspect outputs or measured checks before claiming correctness or improvement.

## Cases to consider only when relevant

| Affected guarantee | Possible discriminating checks |
| --- | --- |
| Shape, ROI or coordinate mapping | Small/odd dimensions, a known impulse or coordinate ramp, crop offset/scale and valid-region alignment |
| CFA or grouped sensor samples | Verified pattern and phase; distinguish channel positions; exercise a crop origin that changes phase if supported |
| Numeric range or precision | Black/white levels, values near a threshold or clipping limit, signed/unsigned behavior, rounding and intermediate precision |
| Neighborhood or border behavior | Constant input, an impulse, edges/corners and dimensions near the support size; confirm the documented boundary policy |
| Stateful or streaming behavior | Reset, frame/chunk boundaries and repeated identical runs; compare chunked/full execution only when equivalence is claimed |
| Estimator or quality claim | Inputs that exercise its assumptions and failure cases; task-relevant reference, mask coverage/distribution or ROI evidence |
| Performance claim | Same workload, parameters, environment and measurement boundary; account for warm-up and transfers when they affect the claim |

These are selection aids, not required contract fields or tests for every node. Do not invent a quality target when the task provides none. A smaller input/output difference alone does not establish better ISP quality. Use [visualization methodology](visualization-method.md) when a plot/image helps evaluate the claim; preserve the exact data separately from previews.

For optional boundary dumps or private-model exchange, use [reference I/O](reference-io.md). Its existing comparison checks exact bytes only. This method does not add a numerical comparator, infer private APIs, require a C-model, or force one-to-one block/function mappings.

Record measured results and limits in the attempt/activity; update lasting guarantees only when evidence justifies them. Follow [change-impact.md](change-impact.md) for source identity and affected metadata.
