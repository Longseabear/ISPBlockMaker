import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function deleteArtifacts(store, directory, ids) {
  const records = store.get().artifacts;
  const selected = ids.map(id => {
    const record = records.find(a => a.id === id);
    if (!record) throw new Error("삭제 대상이 변경되었습니다. 목록을 다시 확인하세요.");
    return record;
  });
  const staged = [];
  try {
    for (const file of new Set(selected.map(a => a.file))) {
      if (records.some(a => a.file === file && !ids.includes(a.id))) continue;
      if (typeof file !== "string" || path.basename(file) !== file) throw new Error("잘못된 시각화 파일 경로입니다.");
      const source = path.resolve(directory, file);
      if (path.dirname(source) !== path.resolve(directory)) throw new Error("잘못된 시각화 파일 경로입니다.");
      const temporary = source + ".delete-" + crypto.randomUUID();
      if (fs.existsSync(source)) { fs.renameSync(source, temporary); staged.push({source, temporary}); }
    }
    store.removeArtifacts(ids);
  } catch (error) {
    for (const item of staged.reverse()) fs.renameSync(item.temporary, item.source);
    throw error;
  }
  const cleanupPending = [];
  for (const item of staged) {
    try { fs.unlinkSync(item.temporary); } catch { cleanupPending.push(path.basename(item.temporary)); }
  }
  return {deletedIds: ids, cleanupPending};
}
