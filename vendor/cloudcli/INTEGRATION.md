# ISP integration of CloudCLI 1.37.5

## Reused upstream UI

ChatComposer, PromptInput, model/effort and permission menus, slash-command menu,
queued-message card, activity indicator, MessageComponent, streaming Markdown,
code copy/highlighting, Mermaid, tool cards and the image lightbox are upstream
components, not a recreation of screenshots. `UPSTREAM.json` pins their origin.
`source-files.json` lists the imported source closure. Unused upstream application
modules, desktop code and server are not included.

## Adapter and deliberate changes

- `adapter/` maps ISP events, permission requests and actions to the UI. Existing
  ISP sessions, persistence, SDK integration and workspace configuration remain
  authoritative. There is no CloudCLI database or second agent server.
- Same-origin iframe isolates React 18 and Tailwind from the React 19 workbench.
  Both bridge endpoints validate the source window and exact origin. No auth
  token is sent to the iframe. The host uses the existing authenticated API.
- Attachment upload, voice, scheduled-send and unreported token counters are
  removed from the composer. No nonfunctional server controls are presented.
- Markdown images resolve through ISP's workspace image API; the upstream image
  lightbox displays them. Images are not automatically injected into the model.
- Palette file links open read-only workspace text previews. Mermaid uses the
  workbench's dark appearance. Missing timestamps render blank.
- The original standalone app CSS is replaced by isolated Tailwind theme tokens.
  The workbench's Board/Report/Code/Image/Runs controls remain outside the frame.
- Company CLI remains mandatory: ISP never falls back to an SDK-owned executable.
  Settings sources are user/project/local. Discovered nonterminal slash commands
  are shown; `/init` is passed unchanged to the company CLI. Actual command
  availability depends on that installed CLI.

## Build and packaging

Run `npm run setup:chat` after changing the vendored package lock, or `npm run build`
for the full app. A fresh build installs only the frontend dependency lock with
lifecycle scripts disabled. End users install none of these dependencies.

Only `dist/cloudcli` is included in the EXE package. `vendor/cloudcli/node_modules`
is development-only. No Electron, Claude/Codex binary, SQLite or CloudCLI server
package is required. `source.tar.gz` in the output contains integration sources,
excluding workspace data, credentials and node_modules.

## Regression checks

`node --test tests/cloudcli-integration.test.mjs` checks SDK command output and
settings/executable forwarding, file containment and dependency exclusions.
Browser checks must cover real streaming, drafts/queue, stop, approvals, model
menus, image open/close, and Board/Report visibility. A successful Vite build alone
does not verify company-model or CLI compatibility.
