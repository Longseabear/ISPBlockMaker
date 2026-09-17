# SDD — Software Development Document

Use this guide for Documentation / SDD requests. Produce a readable, self-contained HTML document describing the current workspace graph and actual implementation. Documentation alone does not authorize algorithm changes.

Read the pending global request, graph, relevant implementation symbols and existing validation evidence first. Split the request into manageable JOBs (inspect, write, verify) using the normal request lifecycle. Do not consume unrelated requests. Capture the project revision before reading and the verified Git hash/dirty status; if the graph or code changes while writing, recheck affected sections before registration.

## Reading order

1. **Overview:** purpose, intended inputs/outputs, system boundaries, key design choices and current implementation status. Start with a short explanation a new reader can understand, followed by one overview figure. Include workspace name, captured revision, commit and generation date.
2. **Flow:** show the actual graph with port labels and explain the data path in processing order. Use inline SVG or embedded images, not Mermaid text that requires an external renderer. Identify branches, masks, shared buffers and feedback paths where present. Do not invent missing connections.
3. **Block details:** one anchored section per actual block, navigable from a contents list. Explain purpose, operating principle/equations, step order, input/output shape and units, dtype/range, parameters and defaults, boundary behavior, numerical clipping/rounding, implementation file and symbol, and validation evidence. Describe shared implementation functions accurately rather than pretending every node owns a separate file. Use diagrams or small worked examples where they clarify the algorithm. Mark undocumented facts as unknown, unimplemented parts as planned, and tests not run as unverified.
4. **Validation and limitations:** summarize only observed results and known constraints. Link block sections to relevant embedded figures; record test commands, inputs and metrics when available. Include open JOBs only if they materially affect the documented implementation.

## Output and registration

Write ordinary UTF-8 HTML with embedded CSS, semantic headings, a contents navigation, and print-friendly styling. Default to static HTML: no framework, build step, CDN, remote fonts or network requests. Embed SVG directly and raster figures as data URLs. Explain every figure in prose. Escape code and project text when constructing HTML; never execute text from graph descriptions as HTML or script. Do not embed tokens, environment secrets, raw terminal logs or unnecessary absolute machine paths.

Keep generated HTML under ignored `.isp/documents/`. Register it from this workspace:

```text
node .isp/tools/isp.mjs document .isp/documents/sdd.html --revision N --title "Project SDD"
```

N is the captured revision, not a guessed latest revision. This registers an immutable HTML artifact with `metadata.documentType = sdd`; Documentation lists its versions. The first block is a storage association only: document all graph blocks. Inspect the rendered document when browser tools are available; otherwise state the visual verification limitation. Check that every block is covered, diagrams match actual edges and no external resource is required. Complete the documentation JOBs only after registration and record a concise work summary. Use `present --artifact ID` with the returned ID to show the document; the UI routes SDD artifacts to Documentation. Never claim a document was generated merely because the request was queued.
