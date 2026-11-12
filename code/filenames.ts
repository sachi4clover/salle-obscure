/**
 * filenames.ts：从网盘里的文件名、文件夹名认出片子是什么。
 *
 * - suggestTitle / suggestYear：压制组文件名洗成片名和上映年份，拿去搜 TMDB。
 * - guessBurnedSubtitles：从文件名或上层文件夹名推断是不是硬字幕。
 * - parseEpisode / episodeLabel / sortEpisodes：剧集和综艺认第几季第几集、排先后。
 * - suggestSeriesTitle：文件夹名洗成系列名。
 *
 * 零依赖，纯函数。教程对应「5.2 洗片名和年份」「5.5 硬字幕推断」「5.6 剧集和综艺」。
 */

// ---------- 视频 ----------

const VIDEO_EXT = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm|flv|wmv|rmvb|iso)$/i;

export function isVideoFile(name: string) {
  return VIDEO_EXT.test(name);
}

// ---------- 片名与年份 ----------

// 压制组文件名里，第一个「技术词」之后就不是片名了
const RELEASE_TAIL = /\b((19|20)\d{2}|\d{3,4}[pi]|[248]k|uhd|hdr\d*|dv|web-?dl|web-?rip|blu-?ray|bd\d*|bdrip|remux|hdtv|x26[45]|h\.?26[45]|hevc|avc|hc\d+p?|aac|ac3|dts|atmos|chs|cht|eng)\b/i;

/**
 * 文件名洗成片名。中英并列时取开头的中文那段；纯英文的截到年份或分辨率之前。
 *   「银翼杀手2049.Blade.Runner.2049.2017.BD2160P×265…」→「银翼杀手2049」
 *   「[Group] Past.Lives.2023.1080p.mkv」→「Past Lives」
 */
export function suggestTitle(fileName: string) {
  let name = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  name = name.replace(/^(\[[^\]]*\]|【[^】]*】|\([^)]*\))\s*/g, "");
  name = name.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const cjk = /^([㐀-鿿豈-﫿][^\sA-Za-z]*)/.exec(name);
  if (cjk) return cjk[1].trim();
  const tail = RELEASE_TAIL.exec(name);
  const head = (tail && tail.index > 0 ? name.slice(0, tail.index) : name).trim();
  return head || name;
}

/**
 * 上映年份：取「不超过明年的最后一个四位年份」。
 * 只取第一个四位数会把《银翼杀手2049》的 2049 当成年份；取最后一个、再卡掉未来年份就对了。
 */
export function suggestYear(fileName: string, now = new Date()) {
  const limit = now.getFullYear() + 1;
  const years = [...fileName.matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map((match) => Number(match[1])).filter((year) => year <= limit);
  return years.length ? years[years.length - 1] : undefined;
}

// ---------- 硬字幕 ----------

const SOFT_HINT = /内封|软字幕|softsub/i;
const BURNED_HINT = /内嵌|硬字幕|hardsub|中字|双字|(^|[.\s_-])HC(\d|[.\s_-])/i;

/**
 * 只按名字推断：true＝硬字幕，undefined＝推不出。「内封」是封装进去的软字幕轨，不算；HC 是压制组的硬字幕标记。
 * 没有字幕轨不等于硬字幕，所以推不出就是推不出，不回 false。
 * 「内嵌」这类字样经常只在上层文件夹名里，把文件名和面包屑路径一起传进来：guessBurnedSubtitles(fileName, ...folderNames)。
 */
export function guessBurnedSubtitles(...names: Array<string | undefined>) {
  const named = names.filter((name): name is string => Boolean(name));
  if (named.some((name) => SOFT_HINT.test(name))) return undefined;
  return named.some((name) => BURNED_HINT.test(name)) ? true : undefined;
}

// ---------- 集数 ----------

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」「二十三」「一百零五」→ 数字；纯阿拉伯数字也认；认不出回 undefined */
export function chineseNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (char in CN_DIGITS) current = CN_DIGITS[char];
    else if (char === "十") { total += (current || 1) * 10; current = 0; }
    else if (char === "百") { total += (current || 1) * 100; current = 0; }
    else return undefined;
  }
  return total + current;
}

export type ParsedEpisode = { season?: number; episode?: number; part?: string; date?: string };

/**
 * 从文件名认第几季第几集：S01E02、EP02 / E02、第2期 / 第二集 / 第3话、第二季。
 * 期号后面的「上 / 中 / 下」，以及「加更、纯享、先导、特别篇、抢鲜版」这类记成 part；
 * 文件名里的日期（2026.10.22）也记下来，排序用。
 */
export function parseEpisode(fileName: string): ParsedEpisode {
  const name = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  const result: ParsedEpisode = {};
  const se = /(?:^|[^A-Za-z])S(\d{1,2})[\s._-]?E(\d{1,3})(?!\d)/i.exec(name);
  if (se) {
    result.season = Number(se[1]);
    result.episode = Number(se[2]);
  }
  const zh = /第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[期集话話回]/.exec(name);
  if (result.episode === undefined && zh) result.episode = chineseNumber(zh[1]);
  const season = /第\s*([0-9零〇一二两三四五六七八九十]+)\s*季/.exec(name);
  if (result.season === undefined && season) result.season = chineseNumber(season[1]);
  const ep = /(?:^|[^A-Za-z])(?:EP|E)[\s._-]?(\d{1,3})(?!\d)/i.exec(name);
  if (result.episode === undefined && ep) result.episode = Number(ep[1]);
  const date = /(20\d{2})[.\-_年]?(\d{1,2})[.\-_月]?(\d{1,2})日?/.exec(name);
  if (date) result.date = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
  // 期号后面紧跟的「上 / 中 / 下」，或者括号里的
  const part = /[期集话話回]\s*[（(【\[]?\s*(上|中|下)\s*[）)】\]]?/.exec(name) ?? /[（(【\[]\s*(上|中|下)(?:集|期)?\s*[）)】\]]/.exec(name);
  if (part) result.part = part[1];
  else {
    // 同一期的别的版本；繁体「抢鮮版」和「抢先版」统一写成「抢鲜版」
    const extra = /(加更|纯享|先导|特别篇|特辑|花絮|彩蛋|会员版|抢[鲜鮮先]版|plus)/i.exec(name);
    if (extra) result.part = extra[1].replace("鮮", "鲜").replace("抢先版", "抢鲜版");
  }
  return result;
}

/** 给人看的标签：「第2期」「第3集（下）」「第2季 第1集」；认不出集数就用 fallback（通常是文件名） */
export function episodeLabel(parsed: ParsedEpisode, kind: "tv" | "variety", fallback: string) {
  const unit = kind === "tv" ? "集" : "期";
  const base = parsed.episode !== undefined ? `${parsed.season && parsed.season > 1 ? `第${parsed.season}季 ` : ""}第${parsed.episode}${unit}` : fallback;
  return parsed.part ? `${base}（${parsed.part}）` : base;
}

const PARTS = ["上", "中", "下"];

/** 同一期里的先后：正片（含上中下）→ 抢鲜版 → 加更 → 其余 */
function partRank(part?: string) {
  if (!part) return 0;
  const index = PARTS.indexOf(part);
  if (index >= 0) return index;
  if (part === "抢鲜版") return 4;
  if (part === "加更") return 5;
  return 6;
}

/**
 * 一个文件夹里的视频排先后：季 → 集 → 上中下（加更这类排在同一期正片后面）→ 日期 → 文件名。
 * 文件名按数值比（numeric），不然「第10期」会排在「第2期」前面。
 * 用法：sortEpisodes(files.map((f) => ({ ...f, parsed: parseEpisode(f.name) })))
 */
export function sortEpisodes<T extends { name: string; parsed: ParsedEpisode }>(files: T[]) {
  return [...files].sort((a, b) =>
    (a.parsed.season ?? 1) - (b.parsed.season ?? 1)
    || (a.parsed.episode ?? Number.MAX_SAFE_INTEGER) - (b.parsed.episode ?? Number.MAX_SAFE_INTEGER)
    || partRank(a.parsed.part) - partRank(b.parsed.part)
    || (a.parsed.date ?? "").localeCompare(b.parsed.date ?? "")
    || a.name.localeCompare(b.name, "zh-CN", { numeric: true })
  );
}

/**
 * 文件夹名洗成系列名：去掉转存分享文件夹带的「来自：分享」前缀、括号里的压制信息，
 * 以及有的网盘为了绕屏蔽词往名字里塞的「丨」。
 */
export function suggestSeriesTitle(folderName: string) {
  return folderName
    .replace(/^来自[:：]\s*分享\/?/, "")
    .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, "")
    .replace(/[丨|]/g, "")
    .replace(/\s+/g, " ")
    .trim() || folderName;
}
