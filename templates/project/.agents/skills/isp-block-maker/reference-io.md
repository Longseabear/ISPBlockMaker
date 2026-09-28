# Optional reference inputs and outputs

Use this when the user asks to preserve input/output examples, collect block or pipeline boundary dumps, reuse Viewer crops as reference inputs, or exchange evidence with a private C/C++ model. This is optional: do not require every block to export files, create a reference set for unrelated work, or force Python nodes to match C-model functions. A set can link zero, one or several block IDs; files need not be paired one-to-one. The user's private framework is not required.

The UI is **Reference I/O**. The workspace owns immutable file copies under `.isp/reference-sets/<id>/files/`; metadata stays outside source Git. Bundle sharing includes these sets even when Viewer originals, data/ or visualizations are omitted. A set can also be downloaded as a ZIP with a manifest and original bytes. Do not mistake this ZIP for an ISP `.bundle`.

```text
isp reference-sets
isp reference-create "<workspace>/tmp/reference/register.json"
isp reference-show SET_ID
isp reference-add SET_ID "<workspace>/tmp/reference/add-file.json"
isp reference-update SET_ID "<workspace>/tmp/reference/update.json"
isp reference-compare SET_ID EXPECTED_FILE_ID ACTUAL_FILE_ID
```

Creation JSON example:

```json
{
  "title": "Flat input to threshold output",
  "description": "Boundary evidence for a fused C-model implementation; actual execution conditions here",
  "blockIds": ["flat", "variance", "threshold"],
  "metadata": {"producer": "Python reference", "parameters": {"threshold": 20}},
  "files": [
    {"path": "tmp/run/input.raw", "name": "input.raw", "role": "input", "metadata": {"dtype": "uint16", "shape": [1080,1920], "byteOrder": "little", "bitDepth": 12, "pattern": "GRBG"}},
    {"path": "tmp/run/output.bin", "name": "threshold.bin", "role": "output", "description": "Output after all three blocks", "metadata": {"dtype": "uint8", "shape": [1080,1920]}}
  ]
}
```

All fields except title are optional. Metadata is free JSON; document shape, layout, dtype, stride/packing, CFA phase, units, rounding, border handling or parameters only when relevant and known. File role is input/output/other. Paths resolve from the workspace root, not sourceRoot, and must be inside it. For external files use the UI file upload or explicitly copy an authorized input into workspace tmp/ first. No source file is moved or deleted. `reference-add` takes one file object with path/name/role/description/metadata. `reference-update` requires the latest `updatedAt` and edits title/description/blockIds/metadata without relabeling the original checkpoint association. Limits: 64 files per set, 256 MiB each, 512 MiB total.

For Viewer input, read `viewer-crops` and pass its exact `cropDeliveryId` in creation JSON. Every region is copied separately with ROI and output spec; a grouped crop ZIP is not treated as a single RAW image. Importing does not consume a delivery. Acknowledge the delivery only after completing the requested work.

`checkpointId` can link an existing checkpoint that actually produced the files. Do not invent a checkpoint or claim registration-time Git HEAD proves provenance. Registration records graph hash, HEAD and dirty status only as context. Describe production commands and transformations in metadata/description; if files came from elsewhere, say so.

Compare only files the user intends to compare. The built-in comparator checks exact bytes and gives bounded differing byte offsets, not pixel coordinates or numerical tolerance. Different packing, dimensions or dtypes must be explicitly converted first using documented local code; preserve originals and record conversion conditions. Store C-model outputs as additional files with an informative name/description, regardless of how many Python blocks they represent. Read binary paths with local programs; never print arrays or base64 into chat. No automatic C++ generation, private API inference, calibration success or numerical equivalence is implied.
