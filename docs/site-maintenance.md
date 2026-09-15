# Guide site maintenance

The public installation, usage and workspace-sharing guide is served from `main:/docs` with GitHub Pages. `.nojekyll` keeps the HTML/CSS/JS site static; no npm build is needed.

- Entry: `index.html`; styling: `site.css`; interactions: `site.js`.
- `assets/*.jpg` are actual UI screenshots taken with a separate synthetic guide workspace. Do not publish real project data or local terminal paths. Guide examples are not bundled with the installer.
- Download buttons use the latest release asset named `ISPBlockMaker-Setup.exe`. Update the guide version when UI screenshots and behavior are reviewed against a new release.
- Check mobile and desktop layouts, screenshot dialogs, command copy feedback, internal anchors and relative asset links before pushing.
- Only public documentation belongs here: never add workspaces, connection files, credentials or raw project inputs.

Site: https://longseabear.github.io/ISPBlockMaker/
