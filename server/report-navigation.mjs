// Added only to the local preview response; stored and exported reports stay unchanged.
export function withReportNavigation(html) {
  const bridge = `<script>window.addEventListener('keydown',function(e){if(!e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing)return;var action=/^[1-5]$/.test(e.key)?'view:'+(Number(e.key)-1):({ArrowLeft:'terminal:previous',ArrowRight:'terminal:next',PageUp:'terminal:previous',PageDown:'terminal:next'})[e.key];if(!action)return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)parent.postMessage({channel:'isp-report-navigation',action:action},'*');},true);</script>`;
  // Preserve the doctype (standards mode) and install before report scripts.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const offset = doctype ? doctype[0].length : 0;
  return html.slice(0, offset) + bridge + html.slice(offset);
}
