/**
 * sprite-scenes.ts：从网盘给的预览雪碧图里粗算整部片的镜头切换点，不用解码视频。
 *
 * 很多网盘（和视频站）为拖进度条准备了预览雪碧图：每隔几秒一格小图，拼成一张张大图。
 * 把每一格算成色彩直方图，前后各一段窗口的平均直方图差得最多的地方，就是换场。
 *
 * - tileHistogram：一格画面 → 8 色相 × 4 明度的归一直方图。
 * - sceneBoundaryIndexes：直方图序列 → 分界格下标。纯函数，可以直接喂测试数据。
 * - scenesFromBoundaries：分界时刻 → 场景段。
 * - spriteSceneBoundaries：拉雪碧图、切格、算直方图，回分界时刻（秒）。只有这一个函数要 sharp，
 *   而且是用到时才加载；只用前面几个纯函数的话不装 sharp 也行。
 *
 * 实测（约 6 秒一格的雪碧图）：一部两个半小时的片子 1634 格，出 70 个分界，中位间隔 108 秒，
 * 抽看六处都落在真换场上，误差在一格以内。暗场里的换场常常够不上阈值，所以过长的段会在段内补一刀。
 *
 * 教程对应「4.9 预览雪碧图」「7.5 台词：场记本」。
 */

export type SceneSpan = { start: number; end: number };

/** 雪碧图的描述。网盘回执的字段名各家不同，自己映射成这个形状 */
export type SpritePreview = {
  cols: number; // 每张几列
  tileW: number; // 每格宽（像素）
  tileH: number; // 每格高（像素）
  sheets: Array<{
    url: string;
    frameCount: number; // 这一张里有几格（最后一张常常不满）
    times: number[]; // 每格对应的片内时间，毫秒
  }>;
};

const HUE_BINS = 8;
const VALUE_BINS = 4;

/** 一格画面 → 8 色相 × 4 明度的归一直方图（输入是 RGB 交错的原始字节） */
export function tileHistogram(rgb: Uint8Array): number[] {
  const hist = new Array(HUE_BINS * VALUE_BINS).fill(0);
  const pixels = Math.floor(rgb.length / 3);
  for (let i = 0; i < pixels; i += 1) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let hue = 0;
    if (delta > 0) {
      if (max === r) hue = ((g - b) / delta + 6) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
    }
    const h = Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS));
    const v = Math.min(VALUE_BINS - 1, Math.floor(max * VALUE_BINS));
    hist[h * VALUE_BINS + v] += 1;
  }
  return pixels ? hist.map((count) => count / pixels) : hist;
}

export type BoundaryOptions = {
  /** 前后各取几格做平均，默认 5（约 30 秒） */
  window?: number;
  /** 两个分界至少隔几格，默认 10（约 60 秒） */
  minGap?: number;
  /** 一段超过几格就在段内补一刀，默认 60（约 6 分钟） */
  maxGap?: number;
  /** 分数取到第几分位以上才算峰，默认 0.75 */
  percentile?: number;
  /** 分数的绝对下限，默认 0.08 */
  floor?: number;
};

/** 直方图序列 → 分界格下标（分界在该格之前） */
export function sceneBoundaryIndexes(hists: number[][], options: BoundaryOptions = {}) {
  const window = options.window ?? 5;
  const minGap = options.minGap ?? 10;
  const n = hists.length;
  if (n < window * 2 + 1) return [];
  const bins = hists[0].length;
  const mean = (from: number, to: number) => {
    const out = new Array(bins).fill(0);
    for (let i = from; i < to; i += 1) for (let k = 0; k < bins; k += 1) out[k] += hists[i][k] / (to - from);
    return out;
  };
  // 每个位置的分数：前一窗和后一窗平均直方图的 L1 距离的一半（0～1）
  const scores: Array<{ index: number; score: number }> = [];
  for (let i = window; i <= n - window; i += 1) {
    const a = mean(i - window, i);
    const b = mean(i, i + window);
    let diff = 0;
    for (let k = 0; k < bins; k += 1) diff += Math.abs(a[k] - b[k]);
    scores.push({ index: i, score: diff / 2 });
  }
  const sorted = scores.map((item) => item.score).sort((x, y) => x - y);
  const cut = sorted[Math.floor((options.percentile ?? 0.75) * (sorted.length - 1))];
  const threshold = Math.max(cut, options.floor ?? 0.08);
  // 从高分往低取峰，和已取的离得够远才要
  const picked: number[] = [];
  for (const item of [...scores].sort((x, y) => y.score - x.score)) {
    if (item.score < threshold) break;
    if (picked.every((index) => Math.abs(index - item.index) >= minGap)) picked.push(item.index);
  }
  // 太长的段在段内分数最高处补一刀：暗场里的换场常常够不上阈值，不补的话一段能拖十几分钟
  const maxGap = options.maxGap ?? 60;
  for (let guard = 0; guard < n; guard += 1) {
    const marks = [0, ...picked.sort((x, y) => x - y), n];
    let split: number | undefined;
    for (let i = 0; i + 1 < marks.length && split === undefined; i += 1) {
      if (marks[i + 1] - marks[i] <= maxGap) continue;
      const inside = scores.filter((item) => item.index - marks[i] >= minGap && marks[i + 1] - item.index >= minGap);
      if (inside.length) split = inside.reduce((best, item) => (item.score > best.score ? item : best)).index;
    }
    if (split === undefined) break;
    picked.push(split);
  }
  return picked.sort((x, y) => x - y);
}

/** 分界时刻（秒）→ 场景段，首尾补齐，越界的丢掉 */
export function scenesFromBoundaries(boundaries: number[], duration: number): SceneSpan[] {
  const starts = [0, ...boundaries.filter((t) => t > 0 && t < duration)].sort((a, b) => a - b);
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : duration }));
}

/**
 * 拉雪碧图、切格、算直方图 → 分界时刻（秒，取分界两侧两格时间的中点）。
 * 雪碧图要不要带请求头看各家网盘，要的话自己包一个 fetchImpl 传进来。
 */
export async function spriteSceneBoundaries(preview: SpritePreview, fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const { default: sharp } = await import("sharp");
  const hists: number[][] = [];
  const times: number[] = [];
  for (const sheet of preview.sheets) {
    const response = await fetchImpl(sheet.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`雪碧图请求失败：${response.status}`);
    const image = sharp(Buffer.from(await response.arrayBuffer()));
    for (let k = 0; k < sheet.frameCount && k < sheet.times.length; k += 1) {
      const row = Math.floor(k / preview.cols);
      const col = k % preview.cols;
      const raw = await image
        .clone()
        .extract({ left: col * preview.tileW, top: row * preview.tileH, width: preview.tileW, height: preview.tileH })
        .resize(64, 36, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      hists.push(tileHistogram(raw));
      times.push(sheet.times[k] / 1000);
    }
  }
  return sceneBoundaryIndexes(hists).map((index) => Math.round(((times[index - 1] + times[index]) / 2) * 10) / 10);
}
