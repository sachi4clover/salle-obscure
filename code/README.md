# 私人影院 · 几个能单独拿走的小文件

配合教程《搭一间私人影院：网盘原画 × iOS 原生播放器 × AI 陪看》。整套是原生 App，没法整体开源，这里只放和我们自己的系统无关、拿去就能用的几块。都是 TypeScript 单文件，复制进自己的项目即可。

| 文件 | 做什么 | 依赖 | 教程小节 |
|---|---|---|---|
| `subtitles.ts` | 字幕解码（utf-16 / gb18030）、srt / vtt / ass 解析、按「同名、原文优先」挑字幕 | 无 | 7.5 |
| `filenames.ts` | 文件名洗片名和年份、硬字幕推断、剧集和综艺认集数、排先后、洗系列名 | 无 | 5.2、5.5、5.6 |
| `sprite-scenes.ts` | 从预览雪碧图粗算镜头切换点，不用解码视频 | 只有 `spriteSceneBoundaries` 要 [sharp](https://github.com/lovell/sharp)，用到时才加载 | 4.9、7.5 |
| `all.test.ts` | 上面三个文件的测试 | 无 | |

## 跑测试

```sh
node --experimental-strip-types --test all.test.ts
```

Node 22.6 起支持；23.6 起可以省掉 `--experimental-strip-types`。也可以直接放进自己的 vitest / jest 里跑，把 `node:test` 换掉就行。

## 几个例子

```ts
import { suggestTitle, suggestYear, guessBurnedSubtitles } from "./filenames";

const file = "银翼杀手2049.Blade.Runner.2049.2017.BD2160P×265.AC3.English.CHS-ENG.mp4";
suggestTitle(file);                              // "银翼杀手2049"
suggestYear(file);                               // 2017（不是 2049）
guessBurnedSubtitles(file, "银翼杀手 4K 内嵌中字"); // true，文件夹名里写了「内嵌」
```

```ts
import { decodeSubtitleBytes, parseAnySubtitles, pickSubtitle } from "./subtitles";

const chosen = pickSubtitle(folderFiles, videoName, tmdb.original_language);
const cues = parseAnySubtitles(chosen.name, decodeSubtitleBytes(bytes));
// [{ start: 12.3, end: 15.1, text: "…" }, …]
```

```ts
import { spriteSceneBoundaries, scenesFromBoundaries } from "./sprite-scenes";

// 把你那家网盘的雪碧图描述映射成 SpritePreview：每张几列、每格宽高、每格对应的毫秒时间
const cuts = await spriteSceneBoundaries(preview);
const scenes = scenesFromBoundaries(cuts, durationSeconds);
```

## 许可

MIT，见同目录 `LICENSE`。只管这个目录里的代码，教程正文不在内。
