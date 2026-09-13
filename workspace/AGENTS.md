# ISP workspace

For ISP block implementation, node/edge edits, or visualization registration anywhere under this workspace, read `.agents/skills/isp-block-maker/SKILL.md` relative to this AGENTS.md. That project-local skill applies to descendant folders as well. Use the absolute path to this folder's `isp.mjs` when working from a nested directory. The skill supports add-block, delete-block, connect, disconnect, update and artifact; consult it before graph mutations.

This folder contains ISP block implementations and generated visualizations. The local ISP Block Maker server is the authority for graph metadata.

Global graph requests/JOBs are in `project.globalWork`. Default `requests` and `jobs` include them alongside block work; inspect `scope`. Use `--global` instead of `--block ID` for global list/split/start/complete/reopen commands. The shared skill documents the same graph scope and completion rules for these tasks.

After authorized block/graph implementation and validation, automatically create a local Git commit for the relevant graph and source changes before marking JOBs complete. Record the verified commit hash in the JOB completion note. Use the existing parent repository, explicitly add new relevant sources, exclude local/generated data, and preserve unrelated edits/staging. Follow the shared skill's “Automatic local Git commits” section for scope, first commits, and failures. No automatic push is authorized.

`graph.json` in this workspace is the Git-managed graph specification; version it together with implementation code. Requests, JOBs, artifact records and selection/revision live separately in the ignored `.isp/project.json` outside this workspace. Use the bridge for edits; do not copy runtime fields into graph.json. After a Git restore, re-read project/context before editing; refresh the browser to see it. Local work/results survive restores and attach by stable block ID, so do not reuse IDs for unrelated blocks.

Implementation is scoped to the requested graph blocks and connections, including when implementing user request memos. Follow the shared skill's “Implement the graph, within its boundaries” section: prefer explicit functional block composition, allow justified stateful or other structures, and do not introduce unrepresented processing stages or unrelated application/framework work.

For requests to implement block memos (for example “Block 메모한 거 전부 구현해줘”), read `isp requests` and `isp jobs` across all blocks. The user writes plain text; the agent uses `split-request` to consume it into linked JOB cards, then `start-job` / `complete-job` to implement and validate each one. Conversion is not completion. Reads never consume work. The user may delete JOBs in the UI; do not recreate or continue deleted JOBs. See the local skill for command syntax, concurrency, graph scope, and presentation rules.

Context responses distinguish `human` (overview) and `agent` (algorithm, implementation path, structured contract and shared I/O). Treat `agent.shared` as the common port/parameter specification. Read `agent.contract` for data format, boundaries, numeric rules, implementation steps, validation commands and acceptance criteria. Empty fields are unspecified, not permission to invent guarantees. The legacy `block` field remains available for compatibility.

Before working on a block, call the local bridge and read its description, principle, ports, parameters, connections, and revision:

- PowerShell: `node $env:ISP_CLI context`
- Windows cmd: `isp context` or `node "%ISP_CLI%" context`
- bash: `node "$ISP_CLI" context`
- Fallback from this directory: `node ../scripts/isp.mjs context`

`ISP_BLOCK_ID` pins the block selected when the web terminal started. `context --selection` explicitly reads the UI's current selection instead. Capture the block ID and revision at the beginning of a task; do not silently change targets while working.

Use `node ../scripts/isp.mjs project` for the full graph. Update metadata via `node ../scripts/isp.mjs update patch.json --block ID --revision N`. A revision conflict requires re-reading state and reconciling the changes. Never edit `.isp/project.json` directly. Implementation paths are relative to this folder.

Create HTML/PNG/JPEG/WebP files under `artifacts/generated/`. Register a finished result with `node ../scripts/isp.mjs artifact artifacts/generated/result.html --block ID --revision N --title "Result" --run RUN_ID`. Use the revision captured when producing the result. HTML must be self-contained with inline CSS/JS and data images; it is rendered in a sandbox with no network, parent DOM, storage, or local control API access.

Use `node ../scripts/isp.mjs demo` for the executable synthetic example. Do not describe this example as a RAW sensor validation or RTL implementation. Block status supports only draft/implemented; test evidence belongs in result metadata.
