export function terminalClipboardHandler(options: {
  readText: () => Promise<string>;
  paste: (text: string) => void;
  ready: () => boolean;
  error: (message: string) => void;
  selection?: () => string;
  writeText?: (text: string) => Promise<void>;
  copySelection?: () => boolean;
  selectAll?: () => void;
}) {
  let pending = false;
  return (event: KeyboardEvent): boolean => {
    const modifier=event.ctrlKey||event.metaKey;
    if(modifier&&!event.altKey&&event.shiftKey&&event.key.toLowerCase()==="a") {
      event.preventDefault();event.stopPropagation();
      if(event.type==="keydown")options.selectAll?.();
      return false;
    }
    if(modifier&&!event.altKey&&(event.key.toLowerCase()==="c"||(!event.shiftKey&&event.key==="Insert"))) {
      const text=options.selection?.()||"";
      if(!text&&!event.shiftKey)return true; // Preserve Ctrl+C to interrupt the shell.
      if(text&&!event.shiftKey){
        // Let the browser dispatch its native copy event to xterm's copy handler.
        // Preventing default here forces clipboard-write permission unnecessarily.
        event.stopPropagation();return false;
      }
      event.preventDefault();event.stopPropagation();
      if(event.type==="keydown"&&!event.repeat&&text) {
        if(options.copySelection?.())return false;
        if(options.writeText)void options.writeText(text).catch(()=>options.error("복사하지 못했습니다. 브라우저 클립보드 권한을 확인하세요."));
        else options.error("클립보드 복사를 지원하지 않습니다.");
      }
      return false;
    }
    const pasteKey = !event.altKey && (
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") ||
      (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === "Insert")
    );
    if (!pasteKey) return true;
    // Normal Ctrl/Cmd+V uses the browser paste event, which xterm already handles.
    // It does not require navigator.clipboard.readText permission.
    if(modifier&&!event.shiftKey&&event.key.toLowerCase()==="v") {
      event.stopPropagation();
      if(!options.ready()){event.preventDefault();if(event.type==="keydown")options.error("터미널 연결 후 붙여넣으세요.");}
      return false;
    }
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
