# Intermediate work products

Read `workspace-info` and create intermediate work products under `<tmpDir>/<task-or-job-id>/` (normally `<workspace>/tmp/`): scratch scripts, temporary request/patch/summary JSON, debug logs, exploratory plots and intermediate image outputs. Do not create another tmp directory in `sourceRoot` merely because it is the current directory. Create the directory as needed and use a task-specific subfolder so concurrent work does not overwrite another task.

Keep final implementation sources/tests in `sourceRoot` and stable inputs in their designated workspace locations, outside `tmp/`. Promote useful final visualizations or documents to a durable workspace location before registering them with the ISP bridge. Do not leave a graph implementation path or final artifact dependency pointing into `tmp/`.

The workspace-root `tmp/` directory is excluded from Git and project bundles. Do not commit it or rely on it being present for another user. Do not move user-provided original files into it. Clean up only your own temporary files when they are no longer needed; do not delete another task's intermediate work.

This rule also applies when older command examples use `.isp/` for temporary JSON; reserve `.isp/` for framework-managed state and tools.
