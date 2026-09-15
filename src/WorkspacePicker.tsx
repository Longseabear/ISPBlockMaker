import { useEffect, useRef, useState } from "react";
import type { Api } from "./types";
type Listing = {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
};
export function WorkspacePicker({
  api,
  current,
  onClose,
  onPick,
}: {
  api: Api;
  current: string;
  onClose: () => void;
  onPick?: (path:string) => void;
}) {
  const [path, setPath] = useState(current),
    [listing, setListing] = useState<Listing | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState(false);
  const requestId = useRef(0);
  async function browse(target: string) {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setListing(null);
    try {
      const result = await api<Listing>(
        `/folders?path=${encodeURIComponent(target)}`,
      );
      if (id === requestId.current) {
        setListing(result);
        setPath(result.path);
      }
    } catch (e) {
      if (id === requestId.current) setError(String(e));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  useEffect(() => {
    void browse(current);
  }, []);
  async function open() {
    if (!listing) return;
    if(onPick){onPick(listing.path);return;}
    setOpening(true);
    setError("");
    try {
      await api("/workspace", { path: listing.path, stopTerminals: true });
      location.reload();
    } catch (e) {
      setError(String(e));
      setOpening(false);
    }
  }
  return (
    <div className="workspace-picker-backdrop">
      <section
        className="workspace-picker"
        role="dialog"
        aria-modal="true"
        aria-label={onPick?"복원 위치 선택":"작업 폴더 선택"}
      >
        <header>
          <h2>{onPick?"복원할 부모 폴더 선택":"작업 폴더 선택"}</h2>
          <button
            onClick={onClose}
            disabled={opening}
            aria-label="폴더 선택 닫기"
          >
            ×
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void browse(path);
          }}
        >
          <label>
            폴더 경로
            <input
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setListing(null);
              }}
              disabled={opening}
            />
          </label>
          <button disabled={busy || opening}>찾아보기</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <div className="folder-list">
          {busy ? (
            <p>폴더 불러오는 중…</p>
          ) : (
            listing && (
              <>
                <button
                  disabled={opening || listing.parent === listing.path}
                  onClick={() => browse(listing.parent)}
                >
                  ↑ 상위 폴더
                </button>
                {listing.directories.map((d) => (
                  <button
                    disabled={opening}
                    key={d.path}
                    onClick={() => browse(d.path)}
                  >
                    📁 {d.name}
                  </button>
                ))}
                {!listing.directories.length && <p>하위 폴더가 없습니다.</p>}
              </>
            )
          )}
        </div>
        <p className="hint">{onPick?"선택한 폴더 아래에 새 프로젝트 폴더를 만듭니다.":"작업 폴더를 전환하면 연결된 터미널이 종료됩니다. 기존 프로젝트 지침은 보존합니다."}</p>
        <footer>
          <button onClick={onClose} disabled={opening}>
            취소
          </button>
          <button
            className="primary"
            disabled={!listing || busy || opening}
            onClick={open}
          >
            {onPick?"이 위치 선택":opening ? "전환 중…" : "이 폴더에서 작업"}
          </button>
        </footer>
      </section>
    </div>
  );
}
