# Intermediate work products

Create intermediate work products under `<workspace>/tmp/<task-or-job-id>/`: scratch scripts, temporary request/patch/summary JSON, debug logs, exploratory plots and intermediate image outputs. Create the directory as needed and use a task-specific subfolder so concurrent work does not overwrite another task.

Keep final implementation sources, tests and stable inputs in their normal project locations, outside `tmp/`. Promote useful final visualizations or documents to a durable project location before registering them with the ISP bridge. Do not leave a graph implementation path or final artifact dependency pointing into `tmp/`.

The workspace-root `tmp/` directory is excluded from Git and project bundles. Do not commit it or rely on it being present for another user. Do not move user-provided original files into it. Clean up only your own temporary files when they are no longer needed; do not delete another task's intermediate work.

This rule also applies when older command examples use `.isp/` for temporary JSON; reserve `.isp/` for framework-managed state and tools.
