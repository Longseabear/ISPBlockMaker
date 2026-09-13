import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readImplementation, locateEntry } from "../server/source.mjs";

test("shared Python entry lookup preserves multiline context and resolves qualified methods", () => {
  const code =
    '# def fake():\n"""\ndef fake():\n"""\n\ndef flat_detection(image):\n    return image\n\nclass Denoiser:\n    async def process(self, image):\n        return image\n\nclass Other:\n    def process(self, image):\n        return image\n';
  assert.equal(locateEntry(code, "Python", "", "flat-detection").startLine, 6);
  assert.equal(locateEntry(code, "Python", "Denoiser.process").startLine, 10);
  assert.equal(locateEntry(code, "Python", "process").entryFound, false);
  assert.equal(locateEntry(code, "Python", "fake").entryFound, false);
  assert.equal(
    locateEntry("\n" + code, "Python", "Denoiser.process").startLine,
    11,
  );
  assert.equal(
    locateEntry(
      "export function processImage() {}",
      "JavaScript",
      "processImage",
    ).startLine,
    1,
  );
});

test("source reader returns current Python text and rejects missing, binary and outside files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "isp-source-"));
  const workspace = path.join(dir, "workspace");
  await fs.mkdir(workspace);
  try {
    const code = "def denoise(image):\n    # 평탄화\n    return image\n";
    await fs.writeFile(path.join(workspace, "block.py"), code);
    assert.equal(
      (await readImplementation(workspace, "block.py")).content,
      code,
    );
    assert.equal(
      (await readImplementation(workspace, "block.py")).language,
      "Python",
    );
    await fs.writeFile(path.join(workspace, "block.py"), "# updated");
    assert.equal(
      (await readImplementation(workspace, "block.py")).content,
      "# updated",
    );
    await fs.writeFile(path.join(dir, "outside.py"), "private");
    await assert.rejects(
      readImplementation(workspace, "../outside.py"),
      /workspace/,
    );
    await assert.rejects(readImplementation(workspace, "missing.py"));
    await assert.rejects(readImplementation(workspace, ""));
    await fs.writeFile(path.join(workspace, "binary.py"), "\0");
    await assert.rejects(
      readImplementation(workspace, "binary.py"),
      /바이너리/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
