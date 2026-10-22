# Workspace MCP and evidence search

## Choose the available interface

`isp-workspace` is supplied to new agents launched by ISP Block Maker. The local MCP uses the running workspace server. Skills explain conventions; tools perform the supported operations. Keep using the CLI for operations absent from the actual tool catalogue. Do not edit managed graph JSON or local tracking records directly as a fallback.

| Intent | Local MCP tools |
| --- | --- |
| Find a diagram / inspect its structure | `list_diagrams`, `get_diagram` |
| Read a block contract and document locations | `get_block_context` |
| Find relevant facts | `search_workspace`, `retrieve_context`, `count_matches`, `read_document` |
| Highlight / fit Board blocks and edges | `present_board` with explicit block/edge IDs |
| Open a registered report | `present_report` |
| Register / replace / remove report files | `list_reports`, `register_report`, `update_report`, `delete_reports` |
| Register and show a standard image | `import_viewer_image`, then `control_viewer` |
| Confirm the display command applied | `get_viewer_command` |
| Inspect viewport/crop metadata | `get_viewer_state`, `get_crop_selection` |
| Read numerical samples / ROI statistics | `get_image_pixels`, `get_image_statistics` |
| Inspect harness execution | `list_harness_runs`, `get_harness_run` |
| Create / rename / remove an empty diagram | `create_diagram`, `update_diagram`, `delete_diagram` |
| Add / remove blocks and connections atomically | `edit_graph` |
| Update a block's descriptions, contract or ports | `update_block` |
| Validate / start / control a harness | `check_harness`, `start_harness`, `control_harness` |
| Register / track JOBs | `list_jobs`, `create_job`, `update_job`, `delete_job` |
| Manage reusable Runs commands | `list_runs`, `get_run_recipe`, `save_run_recipe`, `delete_run_recipe` |
| Execute a saved Run | `launch_run`, `list_terminals` |
| Request and process user crops | `request_viewer_crops`, `get_crop_request`, `get_crop_selection`, `get_crop_statistics`, `acknowledge_crop_selection` |

## Changes and execution

Mutation tools require a UUID `request_id`. Retrying the same logical request uses the same ID and payload; the server returns the recorded result without repeating the operation. Reusing the ID for different input is a conflict. After an uncertain outcome (for example, server termination during a call), inspect current state before deciding whether a new request is necessary. Do not switch IDs blindly to force a retry.

Graph changes require the revision actually read. Reconcile revision conflicts before creating a new request. Use `edit_graph` for a batch that must succeed or fail together; deleting a block with connections requires explicit `remove_connected_edges`. It does not authorize deleting related source files. `update_block` preserves omitted top-level fields; nested contract objects must retain all values that should survive. Jobs and user requests use their separate workflow.

Harness start returns a run, not proof of completion. Poll `get_harness_run` for progress, and use the current run version when controlling it. A disconnected MCP client does not cancel the run. Manual mode and waiting confirmations remain distinct from automatic execution; only report completion when the run and its evidence confirm it.

Runs registration does not execute the script. Read the recipe and its hash before launch; `expected_hash` protects against changes after review. `launch_run` opens the Windows terminal and returns its session ID. Inspect the actual output and run manifest before reporting success. A terminal being idle or absent alone is not proof that the script succeeded. JOB registration likewise only records work; marking it done requires a concrete resolution.

For reports, generate the HTML or image file inside the workspace, then call `register_report` with its path, target block and source revision. The server reads the file; do not send base64 through model context. Registration and display are separate: use `present_report` when the user wants to see it. To replace an existing report, read `list_reports` and pass its current `file` as `expected_file` to `update_report`; stale replacements are rejected. Deleting a registered report removes its managed copy, not the original authoring file.

Pin the relevant diagram/block IDs at the start of the task; UI selection changes do not change the assignment. Presentation changes the view, not the graph layout. `delivered` counts recipients, not successful display; a pending command or a deferred presentation behind unsaved edits is not proof of application. Avoid repeatedly overriding the user's view.

Image display tools return text metadata, never model image input. A text-only company model can still create plots and show them in the UI. Use numeric statistics or local scripts for quantitative analysis. Sending image pixels to the model is a separate, explicit vision operation and requires model support. Never paste base64 or RAW bytes into text context.

## Search, then read evidence

1. Start with `search_workspace` using the topic and optional diagram/block filters. Use quoted phrases for exact wording; `mode: all` requires all terms and `mode: any` broadens matching. Prefer natural terms and identifiers over elaborate query syntax.
2. Search returns ranked original excerpts, document IDs, source paths or fields, content hashes and line ranges. A search hit is evidence to inspect, not a generated answer. `count_matches` counts indexed documents, not occurrences, messages, blocks or executed tests.
3. Use `read_document` with the returned document ID and hash for the relevant section. On a changed-document error, search again and reconcile the new evidence. Continue with bounded line windows when necessary.
4. Cite the underlying path/field and relevant section. Distinguish implemented behavior, documented intent and measured results. Inspect actual code before claiming implementation behavior. The local index includes supported text sources explicitly referenced by block implementation paths; it does not recursively index all code or chat history. Shared connections include only sources selected by the owner.

`retrieve_context` bundles original excerpts with matching blocks and their immediate neighbors' I/O contracts and connecting edges (up to eight blocks). `max_chars` bounds the complete JSON response; inspect `truncated` and retrieve omitted sections through `read_document` when necessary. Block contracts include document IDs and hashes. A changed graph during retrieval requires a new request. It does not infer missing facts, execute code, or prove that all neighboring blocks have been inspected. An empty result means no match in the indexed scope, not proof that the feature does not exist. Large/binary files may be skipped; do not silently interpret skipped files as empty.

## Authoring searchable blocks

- Give each block a meaningful domain name: `Temporal denoise`, not `Step 3` alone. Mention useful aliases once in the description or document (for example, temporal denoising / TNR / 시간축 노이즈 제거). Do not pad keywords.
- Keep the card to its role and output in one or two sentences. Put explanations and limitations in Detail; put shapes, units, ranges, precision, state and acceptance conditions in the agent contract.
- Long explanations belong in the block folder's README or `docs/*.md`, discovered from block context. Use descriptive headings such as Purpose, Inputs and outputs, Numerical behavior, Validation and Known limitations only where useful. Link the canonical document from related explanations.
- Keep stable IDs in references, alongside readable names. Explain dependencies and port meaning; a graph edge alone does not document units or coordinate conventions.
- Keep role-specific helper scripts and small fixtures beside the block when useful. Product code, production tests and shared libraries stay in the project's existing source layout. Do not migrate the whole project into documentation folders.
- Record measured results with their inputs, source revision and conditions in registered results/activity. Do not make one run's outcome a timeless contract. Label untested plans explicitly.
- Do not place credentials, private messages or sensitive data in public-facing Board descriptions or docs. Workspace MCP sharing exposes those documents live when enabled; editing them changes shared evidence.

## Shared MCP

A LAN share is a read-only documentation interface. It offers search and document retrieval, not local viewer control, jobs, shell access or agent execution. The capability URL grants access; do not print it into reports or share it unless requested. Sources are excluded unless the owner selects individual referenced files in the sharing UI. Selected source content is live, so later changes are shared too. Image data is not included by default. If the owner selects images, `list_shared_images` returns only their metadata and `read_shared_image` explicitly returns a native image preview (maximum 512 pixels per side). This requires a vision-capable model; it neither opens the owner's viewer nor provides numerical RAW samples. Local-only tool absence in a shared connection is expected; do not try alternative API paths to bypass its scope.
