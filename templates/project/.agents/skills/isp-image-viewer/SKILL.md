---
name: isp-image-viewer
description: Open RAW/BMP and supported images in ISP Image Viewer, control zoom/pan/render/highlights, inspect the user's live view, and read single/grouped user crops. Use for 뷰어에 띄워, 이 RAW 보여줘 or 지금 보는 부분; reports/plots belong to isp-visualizations.
---

# Image Viewer

Read [shared rules](../isp-block-maker/common.md) once and the relevant section of [viewer.md](../isp-block-maker/viewer.md):

- **Open an image first** for display requests. Use `viewer-open FILE` (RAW: `--spec SPEC_JSON`), not registration alone or a crop request. Check `displayed` and command acknowledgement. Read actual source metadata or ask for missing RAW conditions; never guess dimensions/order solely from file size.
- **Bidirectional display control and shared views** for zoom/center/highlights, render settings or “지금 보는 부분 봐줘”. Use `viewer-control`, `viewer-view`, and `viewer-image current`. Check live freshness and read the returned PNG when image input is available. `--vision` is conditional native image content, not an automatic external model call. The current view does not need a saved crop or manual send.
- **Source crops**, **Crop batch description**, and **Multi-region crop items** when the user selects regions. Read explicitly sent `viewer-crops` batches and their shared/per-item descriptions, or the requested `viewer-result`. A grouped item contains multiple `regions[]`; analyze each region file, not its ZIP or only the compatibility first ROI. Drawing alone does not save/send. Deleted/cancelled items remain cancelled.

RAW uses a 16-bit little-endian container with known valid bit depth/alignment. Named patterns are RGGB/GRBG/GBRG/BGGR; group 1/2/4 means Bayer/Tetra/TetraSquare. Preserve complete CFA cells and phase for every crop; period is 2/4/8 source pixels respectively. Read confirmed coordinates/specs rather than assuming a drag retained its exact rectangle.

The agent may read requested image files outside the workspace by absolute path; imports copy them and never modify their originals. Preview PNGs are 8-bit display evidence, not numerical RAW samples. Simple ISP provides group binning, bilinear demosaic and gamma, without white balance/color matrix; do not present it as production ISP or RAW fidelity.

User adjustments and agent commands are both valid; do not repeatedly override the user's view. Display-only work needs no JOB or commit. Analysis using crops/views follows the actual user request; register a requested report through [Visualizations](../isp-visualizations/SKILL.md), and record substantive analysis through [completion.md](../isp-block-maker/completion.md).
