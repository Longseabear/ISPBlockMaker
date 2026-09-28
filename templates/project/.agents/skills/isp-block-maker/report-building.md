# Build a self-contained evidence report

Use `report-build` when existing measured data can be expressed as images, lines, histogram bins or a table. It supplies a reusable local renderer; custom generators remain appropriate for specialized or interactive views. Choose evidence with [visualization-method.md](visualization-method.md).

```text
report-build <tmpDir>/task/report.json --out artifacts/generated/comparison.html
```

The output must be a new `.html` file under the workspace's `artifacts/generated/`; existing reports are not overwritten. The command returns its path, relative path, byte size and section counts. It builds the file only: register the result with `artifact`, then use the returned artifact ID with `present` as described in [Visualizations](../isp-visualizations/SKILL.md).

Example spec using already measured values:

```json
{
  "title": "Measured output profile",
  "subtitle": "Selected row in the sensor domain",
  "sections": [
    {
      "type": "line",
      "title": "Row profile",
      "xAxis": {"label": "Column", "unit": "pixel", "scale": "linear", "min": 0, "max": 2},
      "yAxis": {"label": "Signal", "unit": "DN", "scale": "linear", "min": 0, "max": 1023},
      "series": [{"label": "Current output", "points": [[0, 64], [1, 72], [2, 69]]}]
    }
  ],
  "findings": ["Replace this illustration with a finding supported by the supplied measurements."],
  "limitations": ["Only the selected row was measured."],
  "provenance": [{"label": "Run", "value": "Actual run manifest or attempt reference"}]
}
```

Use actual project values; the example is illustrative. Required top-level fields are `title` and `sections`; `subtitle`, `findings`, `limitations` and `provenance` are optional. Each provenance item is `{ "label": "...", "value": "..." }`; use verified run conditions/source identity from an existing manifest where available. The builder does not execute the pipeline or infer run provenance.

Supported sections:

| `type` | Data |
| --- | --- |
| `images` | `title`, optional shared `scale` (default 1), and `images: [{path, label, caption?}]` |
| `line` | `title`, `xAxis`, `yAxis`, and `series: [{label, points: [[x,y], ...]}]` |
| `histogram` | `title`, `xAxis`, `yAxis`, and already computed `bins: [{start, end, count}]` |
| `table` | `title`, `columns: [string]`, and `rows` as arrays of string, number, boolean or null cells |

Chart axes state `label`, nonempty `unit` (use `unitless` when appropriate), `scale` (`linear` or `log`), `min` and `max` explicitly. Select meaningful shared scales for comparisons; out-of-range or nonfinite data is rejected rather than silently clipped. Use positive domains/data for log axes. Histogram bins must be ordered and nonoverlapping with nonnegative counts; linear histogram y axes start at zero. Compute bins and points with the inspected project analysis rather than inventing values to fill a chart.

Image paths may be workspace-relative or absolute within the workspace; symlink paths are rejected. PNG/JPEG/WebP images are embedded at the same pixel scale within their section (`scale` 0.05–4, default 1), with horizontal scrolling instead of independent fit-to-width normalization. Supply aligned crops or disclose different regions and transforms. Difference images must be supplied explicitly; the builder performs no numerical comparison or image-domain conversion.

Limits: 2 MiB JSON spec, 10 MiB output, 4 MiB per image/6 MiB images total, 32 sections, 16 images total/8 per section, 16 series per line chart, 16 columns/1,000 rows per table and 20,000 total chart points/bins/table cells. Reduce data to the useful view or use an appropriate existing generator when the report exceeds these limits; disclose any downsampling.

The resulting HTML is self-contained and works in the sandboxed Visualizations view without network access. Inspect rendering and findings, then register a new result. Refer to [change-impact.md](change-impact.md) for comparable conditions, historical preservation and source/evidence alignment.
