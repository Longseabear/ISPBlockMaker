# Register HTML with local assets

Create the HTML freely, for example `artifacts/generated/report/index.html` with `images/result.png`, `style.css`, and `app.js` beside it. Use ordinary relative references:

```html
<link rel="stylesheet" href="style.css">
<img src="images/result.png" alt="Measured output">
<script src="app.js" defer></script>
```

Call `register_report` with the HTML path, title, block ID, revision and UUID request ID; then `present_report` with the returned artifact ID. To update, use `update_report` with the current `expected_file` from `list_reports`. CLI `artifact` / `artifact-update` use the same packager. Do not manually place base64 in model context and do not write into `.isp/artifacts/`.

Supported packaging:
- Images in `src`, `srcset`, SVG `image` href, icon links and video posters become data URLs. Supported image assets: PNG/JPEG/WebP/GIF/SVG/AVIF/ICO.
- Local stylesheet links become inline CSS. Relative `url(...)` paths resolve from each stylesheet; images and WOFF/WOFF2/TTF/OTF fonts are embedded. Nested plain/media CSS `@import` is expanded. Inline style attributes and style blocks are also processed.
- Classic `.js` / `.cjs` script files become inline scripts. `defer` / `async` scripts use embedded data URLs to retain scheduling. Files must contain browser-ready JavaScript, not Node/CommonJS dependencies.
- Existing embedded images/inline resources remain usable. The original HTML and assets are never changed. Each update packages current files again and refreshes source/asset hashes while retaining the report's experiment association.

Paths resolve relative to the referring HTML/CSS file and must remain within the workspace; linked files/directories, absolute asset URLs, remote URLs and missing assets produce path-specific errors. `../` is allowed within the workspace. No browser execution or visual-quality check is part of packaging. Ordinary hyperlinks are not bundled.

This is resource packaging, not an application build system: prebundle ES module imports, JavaScript-generated asset references, runtime `fetch()`, CSS `@import layer()/supports()` and nested HTML yourself. Use inline data for runtime data access. Avoid `<base>`. Do not claim these dependencies were resolved automatically.

Limits: final registered file 10 MiB, at most 256 referenced assets and 20 MiB total resource input; each file at most 10 MiB. Base64 increases size. Reduce the selected assets explicitly if the final output exceeds the limit; the packager does not resize or recompress measurements. Direct HTTP content registration has no authoring-directory context and still expects self-contained bytes.
