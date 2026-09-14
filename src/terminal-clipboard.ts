export function terminalClipboardHandler(options: {
  readText: () => Promise<string>;
  paste: (text: string) => void;
  ready: () => boolean;
  error: (message: string) => void;
}) {
  let pending = false;
  return (event: KeyboardEvent): boolean => {
    const pasteKey = !event.altKey && (
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") ||
      (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === "Insert")
    );
    if (!pasteKey) return true;
    // Prevent the browser and xterm from also delivering the same paste/control key.
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown" || event.repeat || pending) return false;
    if (!options.ready()) { options.error("터미널 연결 후 붙여넣으세요."); return false; }
    pending = true;
    void options.readText().then(text => {
      if (!options.ready()) throw new Error("터미널 연결이 끊어졌습니다. 다시 붙여넣으세요.");
      options.paste(text);
    }).catch(() => options.error("클립보드를 읽지 못했습니다. 브라우저의 클립보드 권한을 허용하거나 터미널에서 우클릭 → 붙여넣기를 사용하세요."))
      .finally(() => { pending = false; });
    return false;
  };
}
