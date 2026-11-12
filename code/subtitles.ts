/**
 * subtitles.ts：字幕文件的解码、解析和挑选。
 *
 * - decodeSubtitleBytes：认 utf-16 BOM；utf-8 解不开就按 gb18030（老字幕站的文件大量是 GBK）。
 * - parseSubtitles：srt 和 vtt 一个函数吃。
 * - parseAssSubtitles：ass / ssa，只认 [Events] 里的 Dialogue 行。
 * - pickSubtitle：同目录一堆字幕里挑一份。和视频同名打头的优先，其中原文优先（按 TMDB 的
 *   original_language 在文件名里认语言），没有原文再简中，别的语言最后。
 *
 * 零依赖，Node 18+ 和浏览器都能跑（gb18030 解码要运行环境的 TextDecoder 支持，Node 带完整 ICU 即可）。
 * 教程对应「7.5 台词：场记本」。
 */

export type SubtitleCue = { start: number; end: number; text: string };

const SUBTITLE_EXT = /\.(srt|ass|ssa|vtt)$/i;

export function isSubtitleFile(name: string) {
  return SUBTITLE_EXT.test(name);
}

// ---------- 解码 ----------

export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

// ---------- 解析 ----------

// srt 是 HH:MM:SS,mmm；vtt 允许省掉小时写成 MM:SS.mmm，所以小时位可选
const SRT_TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function parseSrtTimestamp(raw: string): number | null {
  const m = raw.match(SRT_TIME);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, "0")) / 1000;
}

function stripCueMarkup(text: string) {
  return text
    .replace(/<[^>\n]{1,32}>/g, "") // <i> <b> <font …> 这类内联标签
    .replace(/\{\\[^}\n]{1,64}\}/g, "") // ass 残留的 {\an8} 这类
    .trim();
}

/**
 * srt 和 vtt：按空行分块，块里找 "start --> end" 那一行，后面的行并成正文。
 * vtt 的 WEBVTT 头、NOTE / STYLE 块、cue 后面的 position:… 设置都会被自然滤掉。
 */
export function parseSubtitles(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = raw.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim());
    const arrowIndex = lines.findIndex((line) => line.includes("-->"));
    if (arrowIndex === -1) continue;
    const [startRaw, endRaw] = lines[arrowIndex].split("-->");
    const start = parseSrtTimestamp(startRaw ?? "");
    const end = parseSrtTimestamp(endRaw ?? "");
    if (start === null || end === null || end <= start) continue;
    const text = stripCueMarkup(lines.slice(arrowIndex + 1).join("\n"));
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function parseAssTimestamp(raw: string) {
  const m = /^\s*(\d+):(\d{2}):(\d{2})[.:](\d{1,3})\s*$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** ass / ssa：时间是 H:MM:SS.cc，正文从第十段起（正文里可以有逗号），\N 换成空格 */
export function parseAssSubtitles(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    if (!/^Dialogue:/i.test(line)) continue;
    const fields = line.slice(line.indexOf(":") + 1).split(",");
    if (fields.length < 10) continue;
    const start = parseAssTimestamp(fields[1]);
    const end = parseAssTimestamp(fields[2]);
    const text = stripCueMarkup(fields.slice(9).join(",").replace(/\\[Nn]/g, " ").replace(/\\h/g, " ")).replace(/\s+/g, " ").trim();
    if (start === null || end === null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** 按扩展名分派 */
export function parseAnySubtitles(name: string, text: string): SubtitleCue[] {
  return /\.(ass|ssa)$/i.test(name) ? parseAssSubtitles(text) : parseSubtitles(text);
}

// ---------- 挑选 ----------

/** TMDB 的 original_language（ISO 639-1）→ 字幕文件名里常见的写法 */
const LANGUAGE_MARKS: Record<string, RegExp> = {
  en: /\.en(?:g|glish)?\b|英/i,
  ja: /\.ja(?:p|pn|panese)?\b|日/i,
  ko: /\.ko(?:r|rean)?\b|韩/i,
  fr: /\.fr(?:a|e|ench)?\b|法/i,
  de: /\.de(?:u|r|rman)?\b|德/i,
  es: /\.es(?:p|pa|panish)?\b|西/i,
  it: /\.it(?:a|alian)?\b|意/i,
  ru: /\.ru(?:s|ssian)?\b|俄/i
};
const CHINESE_MARK = /chs|\.sc\.|zh|简|chi|中/i;

/**
 * 同目录里挑一份字幕。先看是不是和视频同名打头，再看语言：原文 > 简中 > 其余。
 * 中文片的原文就是中文，originalLanguage 传 "zh" 或不传都走简中优先。
 * 原文优先的理由：模型读原文更准，观众自己在屏幕上看中文。不想要就别传 originalLanguage。
 */
export function pickSubtitle<T extends { name: string }>(files: T[], videoName: string, originalLanguage?: string): T | undefined {
  const stem = videoName.replace(/\.[^.]+$/, "").toLowerCase();
  const original = originalLanguage && !["zh", "cn"].includes(originalLanguage) ? LANGUAGE_MARKS[originalLanguage] : undefined;
  const language = (name: string) => (original?.test(name) ? 0 : CHINESE_MARK.test(name) ? 1 : 2);
  const rank = (name: string) => (name.toLowerCase().startsWith(stem) ? 0 : 3) + language(name);
  return [...files].filter((file) => isSubtitleFile(file.name)).sort((a, b) => rank(a.name) - rank(b.name))[0];
}
