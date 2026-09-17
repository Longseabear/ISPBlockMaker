---
name: isp-documentation
description: Generate an ISP Software Development Document (SDD) in the Documentation tab from the actual graph and code. Use for explicit SDD, Software Development Document or Documentation requests; ordinary result reports and visualization requests use isp-visualizations.
---

# SDD documentation

Read [shared rules](../isp-block-maker/common.md) once and [sdd.md](../isp-block-maker/sdd.md) for the document workflow. Read actual graph/source and existing evidence; documentation alone does not authorize algorithm changes.

Structure the plain self-contained HTML as **Overview → Flow → each block's details → validation/limitations**. Explain overall input/output and verified entry points first, then real port/edge flow, then individual blocks through their I/O, algorithm, parameters, numerical behavior and examples. Include useful embedded figures and mark unknown/planned/unverified facts honestly.

Register through `document FILE --revision N --title "Project SDD"`, using the captured revision and returned artifact ID. This sets the document type for Documentation; merely registering a generic report with `artifact` does not create an SDD. Inspect the rendered document and present the exact registered version. Preserve historical versions.

If a matching global request/JOB exists, follow [job management](../isp-job-management/SKILL.md); do not consume unrelated requests or require a fabricated memo for a direct document request. Record the outcome and validation through [completion.md](../isp-block-maker/completion.md). Use [Visualizations](../isp-visualizations/SKILL.md) for ordinary reports, even if they also contain prose and figures.
