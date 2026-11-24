export const navigationViews = ['Block graph', 'Node implementations', 'Visualizations', 'Image Viewer', 'Terminal Hub'];

export function navigationShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'key'>): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null;
  if (/^[1-5]$/.test(event.key)) return `view:${Number(event.key) - 1}`;
  return ({ArrowLeft: 'terminal:previous', ArrowRight: 'terminal:next', PageUp: 'terminal:previous', PageDown: 'terminal:next'} as Record<string, string>)[event.key] || null;
}

export function nextNavigationIndex(length: number, current: number, direction: number): number {
  if (!length) return -1;
  if (current < 0) return direction > 0 ? 0 : length - 1;
  return (current + direction + length) % length;
}

// Click the existing navigation controls so unsaved-edit guards stay in effect.
export function performNavigationShortcut(action: string): void {
  if (typeof action !== 'string') return;
  if (/^view:(?:[0-4]|previous|next)$/.test(action)) {
    const buttons = navigationViews.map(label => document.querySelector<HTMLButtonElement>(`.workspace-sidebar > button[aria-label="${label}"]`));
    const value = action.slice(5);
    const index = /^\d$/.test(value) ? Number(value) : nextNavigationIndex(buttons.length, buttons.findIndex(button => button?.getAttribute('aria-current') === 'page'), value === 'next' ? 1 : -1);
    buttons[index]?.click();
    return;
  }
  if (action !== 'terminal:previous' && action !== 'terminal:next') return;
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.interaction-workspace, .terminal-panel, .shared-terminals')).filter(panel => panel.getClientRects().length && getComputedStyle(panel).visibility !== 'hidden');
  const panel = panels.find(panel => panel.contains(document.activeElement)) || panels.find(panel => panel.matches('.interaction-workspace, .terminal-panel')) || panels[0];
  if (!panel) return;
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = nextNavigationIndex(tabs.length, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'), action === 'terminal:next' ? 1 : -1);
  tabs[index]?.click();
  tabs[index]?.focus();
  if (index >= 0) requestAnimationFrame(() => {
    // React commits the new selection before returning input to its terminal.
    const input = panel.querySelector<HTMLElement>('.terminal-tab-content:not([hidden]) .xterm textarea, .shared-screen .xterm textarea, .conversation-pane.active textarea, .conversation-pane.active iframe');
    input?.focus();
  });
}

export function installNavigationShortcuts(): () => void {
  const keyboard = (event: KeyboardEvent) => {
    const action = navigationShortcut(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation(); // Do not pass navigation escape sequences to xterm.
    if (!event.repeat && !document.querySelector('[role="dialog"], [data-unsaved-dialog]')) performNavigationShortcut(action);
  };
  const forwarded = (event: Event) => {
    if (!document.querySelector('[role="dialog"], [data-unsaved-dialog]')) performNavigationShortcut((event as CustomEvent<string>).detail);
  };
  const report = (event: MessageEvent) => {
    if (event.origin !== 'null' || event.data?.channel !== 'isp-report-navigation') return;
    const source = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox][src^="/artifacts/"]')).some(frame => frame.contentWindow === event.source && frame.getClientRects().length);
    if (source) forwarded(new CustomEvent('isp-navigation', {detail:event.data.action}));
  };
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('isp-navigation', forwarded);
  window.addEventListener('message', report);
  return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('isp-navigation', forwarded); window.removeEventListener('message', report); };
}
