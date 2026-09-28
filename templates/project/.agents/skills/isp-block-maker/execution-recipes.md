# Reusable local execution recipes

Use a recipe when a project command is worth repeating with different inputs or parameters. First inspect existing recipes, graph entry points and relevant project skills. A recipe may exercise several blocks, and a block may have several recipes; it is not a required per-node executor. Ordinary one-off commands need no recipe.

```text
recipes
recipe-show RECIPE_ID
recipe-save <tmpDir>/task/recipe.json
recipe-plan RECIPE_ID --params <tmpDir>/task/params.json
recipe-run RECIPE_ID --params <tmpDir>/task/params.json --hash OBSERVED_RECIPE_HASH
```

`recipe-show` returns `recipe`, `hash` and `path`. Save JSON contains the complete desired recipe and `expectedHash`: `null` for a new recipe or the exact current hash for an update. Re-read and reconcile conflicts. Recipes live under `<sourceRoot>/.isp-recipes/` and travel with source snapshots/bundles; saving or importing one does not execute it.

Example save JSON, adapted to an actual inspected project command:

```json
{
  "expectedHash": null,
  "recipe": {
    "version": 1,
    "id": "pipeline-preview",
    "title": "Run a representative pipeline input",
    "description": "Exercise the verified pipeline entry point and retain its output.",
    "executable": "python",
    "args": ["pipeline.py", "--input", "{{input}}", "--output", "{{runDir}}/result.png"],
    "cwd": ".",
    "blockIds": [],
    "parameters": {"input": {"description": "Input image path", "required": true}},
    "expectedOutputs": [{"path": "{{runDir}}/result.png", "description": "Pipeline result", "required": true}],
    "timeoutMs": 60000
  }
}
```

`cwd` is relative to `sourceRoot`. `executable` plus `args` are an argument vector executed without a shell. Specify an interpreter and script explicitly; shell operators in arguments do not compose commands. Inspect scripts and their effects as well as the recipe. A declared output list is an output check, not a sandbox for the executed program.

`parameters` describes string values with `description`, `required` and an optional string `default`. A params file is a plain object such as `{"input":"C:/Work/Example/data/sample.png"}`. Substitutions include `{{workspace}}`, `{{sourceRoot}}`, `{{runDir}}` and declared parameter names. Use configurable paths, not one machine's location, in saved recipes. `blockIds` supplies context only and must reflect the actual scope; the runner does not infer stage composition.

Plan before running: `recipe-plan` performs no execution or writes and exposes the resolved invocation, expected outputs and recipe hash. Check that the selected input, command, parameters and destination match the authorized task. The optional `recipe-run --hash HASH` guards against a recipe changing after inspection. Planning and running allocate their own run IDs; use the actual run response for evidence paths.

`recipe-run` executes locally and records `manifest.json`, `stdout.log` and `stderr.log` under `<tmpDir>/recipe-runs/<run-id>/`. Logs retain up to the last 64 KiB per stream and record truncation. The default timeout is 60 seconds; choose a suitable `timeoutMs` in the recipe for the actual workload. The returned status is `succeeded`, `failed` or `timed_out`, with exit/process details and output checks. A pre-existing output satisfies an expected output only if its content changed; prefer `{{runDir}}` for repeat runs that can produce identical results. Inspect failure, timeout and missing-output information before drawing conclusions.

Use the manifest's actual invocation, parameters, source identity and output records as provenance. Identity includes available Git HEAD/dirty state, tracked diff hash and graph hash before/after; `sourceChanged` concerns those observed values, not a complete dependency snapshot. Output records include existence, validity, content hash and whether the run satisfied the expectation. Arguments/parameters are recorded, so keep secrets out of them; the environment is not copied into the manifest.

The manifest does not certify numerical behavior or automatically create an attempt, checkpoint or registered artifact. When producing attempt evidence, retain the manifest reference and link the actually tested checkpoint through [attempt tracking](../isp-version-sharing/work-tracking.md). For long-lived evidence, promote needed files from scratch before registration following [temporary-files.md](temporary-files.md).

Keep reusable execution mechanics in the recipe, the verified graph entry point in the overview, and domain interpretation/prerequisites in a [project skill](project-skills.md) when useful. Avoid duplicating the same command in several authoritative places.
