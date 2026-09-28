---
name: isp-image-viewer
description: Open images in ISP Image Viewer, control the live view, inspect exact pixels, and use user-selected crops for analysis, white balance or managed inputs. Use for 뷰어에 띄워, 지금 보는 부분, or 선택한 크롭; reports/plots belong to isp-visualizations.
---

# Image Viewer

Read [shared rules](../isp-block-maker/common.md) once and the relevant section of [viewer.md](../isp-block-maker/viewer.md):

- **Open an image first** for display requests. Use `viewer-open FILE` (RAW: `--spec SPEC_JSON`), not registration alone or a crop request. Check `displayed` and command acknowledgement. Read actual source metadata or ask for missing RAW conditions; never guess dimensions/order solely from file size.
- **Bidirectional display control and shared views** for zoom/center/highlights, render settings or “지금 보는 부분 봐줘”. Use `viewer-control`, `viewer-view`, and `viewer-image current`. Check live freshness and open the returned PNG with an available image tool. CLI `--vision` returns an image path, never base64 text; native image integrations use the attachment API. The current view needs no saved crop or manual send.
- **Ask the user to choose crops** with [request and wait](../isp-block-maker/viewer-crop-wait.md). The CLI holds its response until the user explicitly sends crops and automatically renews long polling. Keep the tool process running and poll its handle; do not finish the agent turn while awaiting delivery. Use the same request ID after an interrupted wait.
- **Source crops and delivery** for single/grouped regions. Read explicitly sent `viewer-crops` and its delivery ID, purpose, shared/per-item notes and status. Drawing, saving, sending and agent completion are distinct. A grouped item contains `regions[]`; use their files, not its ZIP or just the first ROI. Only acknowledge the exact delivery after handling it; a read alone never consumes it.
- Read [crop analysis](../isp-block-maker/viewer-analysis.md) for WB, exact values or managed input requests. Start with `viewer-crop-stats DELIVERY_ID` (compact per-channel statistics), use `viewer-pixels` only for a small explicit ROI, and process larger binary arrays locally. Preserve crop IDs/specs in the result. A consumed delivery is previous work unless the user requests reanalysis.

RAW uses a 16-bit little-endian container with known valid bit depth/alignment. Named patterns are RGGB/GRBG/GBRG/BGGR; group 1/2/4 means Bayer/Tetra/TetraSquare. Preserve complete CFA cells and phase for every crop; period is 2/4/8 source pixels respectively. Read confirmed coordinates/specs rather than assuming a drag retained its exact rectangle.

When the user wants crops preserved as reference inputs or exchanged with C-model work, use optional [reference I/O sets](../isp-block-maker/reference-io.md). Import the exact delivery ID without consuming it; retain every grouped region and its RAW spec. This does not require a matching C++ node or a reference set for ordinary viewing/WB tasks.

The agent may read requested image files outside the workspace by absolute path; imports copy them and never modify their originals. Preview PNGs are 8-bit display evidence, not numerical RAW samples. Simple ISP provides group binning, bilinear demosaic and gamma, without white balance/color matrix; do not present it as production ISP or RAW fidelity.

Never dump RAW bytes, image base64, or a whole-frame pixel array into the conversation. Use file paths, bounded native previews, compact statistics and local processing. WB gains from a selected region are provisional unless its neutrality and black/white levels are established; inspect Gr/Gb, saturation and valid counts.

User adjustments and agent commands are both valid; do not repeatedly override the user's view. Display-only work needs no JOB or commit. Analysis using crops/views follows the actual user request; register a requested report through [Visualizations](../isp-visualizations/SKILL.md), and record substantive analysis through [completion.md](../isp-block-maker/completion.md).
