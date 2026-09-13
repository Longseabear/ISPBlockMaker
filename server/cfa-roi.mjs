// Align to complete cells of the named CFA pattern, including imported phase.
export function alignCfaRoi(spec, roi) {
  if (spec.format !== "raw") return roi;
  const period = 2 * spec.group;
  function axis(start, length, size, origin = 0) {
    const first = ((-origin % period) + period) % period;
    const last = first + Math.floor((size - first) / period) * period;
    if (last - first < period) throw new Error("이미지에 완전한 CFA 셀이 없습니다.");
    const low = Math.max(first, Math.min(last - period, first + Math.floor((start - first) / period) * period));
    const high = Math.max(low + period, Math.min(last, first + Math.ceil((start + length - first) / period) * period));
    return [low, high - low];
  }
  const [x, width] = axis(roi.x, roi.width, spec.width, spec.originX);
  const [y, height] = axis(roi.y, roi.height, spec.height, spec.originY);
  return {x, y, width, height};
}
