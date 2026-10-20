# GPU simulator extensions

Use for requests to implement an algorithm in GPU simulator. This tab runs WebGL2 fragment shaders, not Python, CUDA, or the graph automatically. Do not keep retrying a CPU entry point expecting it to appear here.

1. Run `workspace-info`, `graph-info` and affected block contexts. Read the actual source. Use `<sourceRoot>/extensions/gpu/<id>.json`, not workspace-level extensions in the separated layout.
2. Inspect existing extensions. Start with this complete identity extension and then translate the requested operation, preserving stated boundary rules. Texture sampling uses source resolution; use explicit clamped coordinates for neighborhood fetches. RGBA8 input is normalized to 0–1, output is clamped/quantized to RGBA8. Input is downscaled to at most 1024 pixels per dimension. This cannot validate full-resolution RAW/16-bit numerics.
3. Save valid JSON; select the extension in GPU simulator and click 확장 새로고침. The tab also refreshes the catalog every 15 seconds. Manifest errors appear separately from shader compile errors. Server validation does not compile GLSL; verify compilation and output in a real WebGL2 browser.
4. Compare the same decoded input and parameters against a CPU reference where feasible. Input-versus-output RMSE is not a CPU equivalence check. Record what was actually run; do not claim success from file creation or hash agreement.
5. After verification, optionally record `reference: {shaderSha256, sources:[{path,sha256}]}` using exact fragment UTF-8 bytes and source-relative files. Hash matching only detects drift. Save results to Visualizations and describe precision limits.

```json
{
  "version": 1,
  "id": "example-gain",
  "name": "Gain example",
  "description": "RGBA8 preview with gain; not a RAW simulator.",
  "ui": {"layout":"columns","controlsCollapsed":false},
  "fragment": "#version 300 es\nprecision highp float;\nuniform sampler2D u_image;\nuniform vec2 u_resolution;\nuniform float gain;\nout vec4 color;\nvoid main(){vec3 c=texelFetch(u_image,ivec2(gl_FragCoord.xy),0).rgb;color=vec4(clamp(c*gain,0.0,1.0),1.0);}",
  "parameters": [{"name":"gain","label":"Gain","group":"Tone","control":"slider","min":0,"max":3,"step":0.01,"default":1}]
}
```

Every parameter is a float uniform. `control` accepts slider (default), number, or select. Select requires `options:[{"label":"Off","value":0},{"label":"On","value":1}]` within min/max and containing default. `group` groups controls in collapsible sections. `ui.layout` supports columns, stack, output; users may override it in the tab. Parameter array order determines order within a group. Arbitrary HTML/JS is not an extension field; use a self-contained Visualization when a custom interactive report is the desired result.

Only supply parameter `blockId` and `parameter` together when the graph parameter exists; shader changes are preview-only until the user applies parameters. Extension-level blockId associates saved results with a real block.
