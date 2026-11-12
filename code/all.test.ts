// 跑法：node --experimental-strip-types --test all.test.ts（Node 22.6+；23.6 起可以省掉 flag）
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSubtitleBytes, parseAssSubtitles, parseSubtitles, pickSubtitle } from "./subtitles.ts";
import { chineseNumber, episodeLabel, guessBurnedSubtitles, parseEpisode, sortEpisodes, suggestSeriesTitle, suggestTitle, suggestYear } from "./filenames.ts";
import { sceneBoundaryIndexes, scenesFromBoundaries, tileHistogram } from "./sprite-scenes.ts";

// ---------- subtitles ----------

test("字幕编码：utf-8、gb18030、utf-16le BOM 都认", () => {
  assert.equal(decodeSubtitleBytes(new TextEncoder().encode("你好")), "你好");
  assert.equal(decodeSubtitleBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])), "你好");
  assert.equal(decodeSubtitleBytes(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])), "你好");
});

test("srt 与 vtt：去标签、跳过坏块、按时间排", () => {
  const srt = "2\n00:00:05,000 --> 00:00:06,500\n<i>second</i>\n\n1\n00:00:01,000 --> 00:00:02,000\nfirst\nline\n\nbroken\n";
  assert.deepEqual(parseSubtitles(srt), [
    { start: 1, end: 2, text: "first\nline" },
    { start: 5, end: 6.5, text: "second" }
  ]);
  const vtt = "WEBVTT\n\nNOTE hi\n\n01:02.500 --> 01:04.000 position:10%\nhello\n";
  assert.deepEqual(parseSubtitles(vtt), [{ start: 62.5, end: 64, text: "hello" }]);
});

test("ass：Dialogue 行、正文带逗号、\\N 换空格、去掉 {\\an8}", () => {
  const ass = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:02.50,0:01:04.00,Default,,0,0,0,,{\\an8}我不需要,任何\\NI don't need any\n";
  assert.deepEqual(parseAssSubtitles(ass), [{ start: 62.5, end: 64, text: "我不需要,任何 I don't need any" }]);
});

test("挑字幕：同名打头 > 原文 > 简中 > 其余；不是字幕的不挑", () => {
  const files = [{ name: "Movie.2017.eng.srt" }, { name: "Movie.2017.chs.ass" }, { name: "Movie.2017.mkv" }];
  assert.equal(pickSubtitle(files, "Movie.2017.mkv")?.name, "Movie.2017.chs.ass");
  assert.equal(pickSubtitle(files, "Movie.2017.mkv", "en")?.name, "Movie.2017.eng.srt");
  assert.equal(pickSubtitle([{ name: "other.eng.srt" }, { name: "Movie.2017.chs.ass" }], "Movie.2017.mkv", "en")?.name, "Movie.2017.chs.ass");
  assert.equal(pickSubtitle(files, "Movie.2017.mkv", "zh")?.name, "Movie.2017.chs.ass");
  assert.equal(pickSubtitle([{ name: "a.mkv" }], "a.mkv"), undefined);
});

// ---------- filenames ----------

test("洗片名", () => {
  assert.equal(suggestTitle("银翼杀手2049.Blade.Runner.2049.2017.BD2160P×265.AC3.English.CHS-ENG.mp4"), "银翼杀手2049");
  assert.equal(suggestTitle("银翼杀手.Blade.Runner.1982.BD2160P×265.AAC.English.CHS-ENG.mp4"), "银翼杀手");
  assert.equal(suggestTitle("Some.Quiet.Film.2026.1080p.WEB-DL.FHD.H.264.AAC2.0-GROUP.mp4"), "Some Quiet Film");
  assert.equal(suggestTitle("[Group] Past.Lives.2023.1080p.mkv"), "Past Lives");
});

test("年份：不超过明年的最后一个四位年份", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  assert.equal(suggestYear("银翼杀手2049.Blade.Runner.2049.2017.BD2160P×265.mp4", now), 2017);
  assert.equal(suggestYear("银翼杀手.Blade.Runner.1982.BD2160P.mp4", now), 1982);
  assert.equal(suggestYear("Some.Film.HC1080P.mkv", now), undefined);
});

test("硬字幕：内嵌 / 中字 / HC 算，内封不算，推不出回 undefined", () => {
  assert.equal(guessBurnedSubtitles("银翼杀手1982 4K高码 内嵌中英双字"), true);
  assert.equal(guessBurnedSubtitles("Some.Film.2026.HC1080P.X265.mkv"), true);
  assert.equal(guessBurnedSubtitles("某片.内封中字.mkv"), undefined);
  assert.equal(guessBurnedSubtitles("Some.Film.2026.1080p.WEB-DL.mp4"), undefined);
  assert.equal(guessBurnedSubtitles("Movie.2026.1080p.mkv", "某片 4K 内嵌中字"), true);
});

test("中文数字", () => {
  assert.equal(chineseNumber("十二"), 12);
  assert.equal(chineseNumber("二十三"), 23);
  assert.equal(chineseNumber("一百零五"), 105);
  assert.equal(chineseNumber("7"), 7);
  assert.equal(chineseNumber("第"), undefined);
});

test("认集数", () => {
  assert.deepEqual(parseEpisode("2026.10.22-第2期.mp4"), { episode: 2, date: "2026-10-22" });
  assert.deepEqual(parseEpisode("某综艺 第十二期（下）.mp4"), { episode: 12, part: "下" });
  assert.deepEqual(parseEpisode("Show.Name.S02E05.1080p.WEB-DL.mkv"), { season: 2, episode: 5 });
  assert.deepEqual(parseEpisode("某剧 EP07 4K.mkv"), { episode: 7 });
  assert.deepEqual(parseEpisode("第3期加更.mp4"), { episode: 3, part: "加更" });
  assert.deepEqual(parseEpisode("2026.10.30-抢鮮版第2期.mp4"), { episode: 2, part: "抢鲜版", date: "2026-10-30" });
  assert.deepEqual(parseEpisode("第二季 第4集.mp4"), { season: 2, episode: 4 });
  assert.equal(parseEpisode("Movie.2019.HEVC.mkv").episode, undefined);
});

test("集数标签与排序", () => {
  assert.equal(episodeLabel({ episode: 2 }, "variety", "x"), "第2期");
  assert.equal(episodeLabel({ episode: 3, part: "下" }, "tv", "x"), "第3集（下）");
  assert.equal(episodeLabel({ season: 2, episode: 1 }, "tv", "x"), "第2季 第1集");
  assert.equal(episodeLabel({}, "variety", "先导片"), "先导片");
  const names = ["第10期.mp4", "第2期加更.mp4", "第2期下.mp4", "第1期.mp4", "第2期上.mp4"];
  const sorted = sortEpisodes(names.map((name) => ({ name, parsed: parseEpisode(name) }))).map((file) => file.name);
  assert.deepEqual(sorted, ["第1期.mp4", "第2期上.mp4", "第2期下.mp4", "第2期加更.mp4", "第10期.mp4"]);
});

test("系列名", () => {
  assert.equal(suggestSeriesTitle("某丨综艺"), "某综艺");
  assert.equal(suggestSeriesTitle("某综艺【4K】(2026)"), "某综艺");
  assert.equal(suggestSeriesTitle("来自：分享/某综艺"), "某综艺");
});

// ---------- sprite-scenes ----------

const colorTile = (r: number, g: number, b: number) => {
  const bytes = new Uint8Array(64 * 36 * 3);
  for (let i = 0; i < bytes.length; i += 3) { bytes[i] = r; bytes[i + 1] = g; bytes[i + 2] = b; }
  return tileHistogram(bytes);
};

test("直方图：纯红进红那格最亮档，纯黑进最暗档", () => {
  const red = colorTile(255, 0, 0);
  assert.equal(red[3], 1);
  assert.equal(colorTile(0, 0, 0)[0], 1);
  assert.ok(Math.abs(red.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("窗口突变：两段颜色交界处出分界，同色段内不出", () => {
  const red = colorTile(255, 0, 0);
  const blue = colorTile(0, 0, 255);
  const green = colorTile(0, 255, 0);
  const hists = [...Array(20).fill(red), ...Array(20).fill(blue), ...Array(20).fill(green)];
  assert.deepEqual(sceneBoundaryIndexes(hists), [20, 40]);
  assert.deepEqual(sceneBoundaryIndexes(Array(40).fill(red)), []);
  assert.deepEqual(sceneBoundaryIndexes(hists.slice(0, 8)), []);
});

test("过长的段在段内补一刀", () => {
  const dark = colorTile(40, 40, 40);
  const darker = colorTile(40, 40, 120);
  const hists = [...Array(50).fill(dark), ...Array(50).fill(darker)];
  assert.deepEqual(sceneBoundaryIndexes(hists, { maxGap: 1000, floor: 1.01 }), []);
  assert.deepEqual(sceneBoundaryIndexes(hists, { maxGap: 60, floor: 1.01 }), [50]);
});

test("分界 → 场景段，首尾补齐，越界丢掉", () => {
  assert.deepEqual(scenesFromBoundaries([120, 300, 9999], 600), [
    { start: 0, end: 120 },
    { start: 120, end: 300 },
    { start: 300, end: 600 }
  ]);
});
