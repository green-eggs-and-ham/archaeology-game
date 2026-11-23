# ISO preview performance

## November rendering comparison

On 23 November 2026, the original and updated games ran in the same headless Chromium 153.0.8010.12 on an Apple M4 Pro with 24 GB of memory. Each case used three warm-ups and 20 recorded samples. Both games used the same stratigraphy, six find silhouettes and 320 × 640 viewport. The updated measurements include the final 80.625 × 40.3125 display image and the smaller cached images. CPU throttling here measures the browser main thread. Physical phone speed and battery use were outside this measurement.

Each timing pair gives the median and 95th percentile in milliseconds per trench.

| Main-thread checkerboard | Full before | Full after | Lite before | Lite after |
|---|---:|---:|---:|---:|
| 1× | 48.6 / 49.3 | 2.5 / 2.9 | 6.5 / 6.8 | 1.0 / 1.2 |
| 4× | 203.4 / 207.1 | 9.6 / 10.5 | 26.7 / 28.2 | 3.7 / 4.9 |
| 6× | 305.7 / 308.2 | 14.8 / 17.9 | 40.4 / 43.0 | 5.8 / 6.8 |

| Other terrain at 6× | Full before | Full after | Lite before | Lite after |
|---|---:|---:|---:|---:|
| Deep floor | 318.0 / 322.8 | 14.4 / 16.2 | 40.8 / 42.8 | 4.8 / 5.6 |
| Irregular mosaic | 288.4 / 292.5 | 15.8 / 17.3 | 39.9 / 42.7 | 6.2 / 8.4 |
| Isolated cliffs | 100.0 / 101.1 | 14.6 / 15.4 | 7.0 / 9.2 | 5.5 / 5.9 |
| Deep comb | 303.0 / 305.5 | 14.7 / 15.3 | 40.6 / 42.2 | 5.6 / 6.6 |

| Checkerboard at 6× | Full before | Full after | Lite before | Lite after |
|---|---:|---:|---:|---:|
| Worker active | 52.8 / 56.0 | 3.6 / 4.4 | 7.6 / 8.5 | 2.2 / 3.1 |
| Worker request to result | 53.3 / 57.0 | 3.8 / 5.4 | 7.8 / 9.1 | 2.6 / 3.6 |
| Sliced fallback active | 284.9 / 289.1 | 15.1 / 17.8 | 39.3 / 41.2 | 5.6 / 7.0 |
| Sliced fallback request to result | 559.9 / 571.5 | 34.3 / 35.9 | 81.5 / 88.1 | 15.1 / 16.4 |
| Find-only composition | 0.8 / 2.1 | 1.2 / 2.2 | 0.1 / 1.5 | 0.1 / 1.2 |

Find-only samples alternated collecting and restoring one find. The updated path reuses the terrain and refreshes the affected part of each cached image. Preparing those additional images accounts for the small increase in Full composition time. The worker had its own clock. The 6× setting applied to the main thread during dispatch and delivery.

| Interactive drawing at 6× | Before, median / p95 | After, median / p95 |
|---|---:|---:|
| Populated Finds Lab | 4.2 / 4.6 | 1.4 / 2.6 |
| Profile after digging outside its row | 10.9 / 11.9 | 0.0 / 0.1 |
| Profile after digging one displayed column | 10.8 / 11.3 | 0.9 / 1.5 |

The Lab replay moved the pointer across a mat holding one wet find, with 46 collected finds in total. The updated run sorted the inventory once and painted the inventory panel once. The profile replay alternated a single cell between two excavated depths. A 0.0 ms value falls below the clock resolution for that sample.

At an opening width of 80.625 pixels, Full wall colour error at the 95th percentile fell from **14.0 to 0.49** in Chromium and from **17.8 to 0.49** in WebKit 26.6, on a 0–255 scale. The reference used exact area averages of the canonical image at four subpixel positions. The measurement includes 2,849 fully covered wall pixels. Both qualities stayed below the 5/255 target across opening widths of 58.31, 80.625, 104, 162 and 260 pixels.

Both engines exercised 240, 280, 320 and 375 pixel portrait widths, 667 pixel landscape and 1080 pixel desktop widths. Touches on walkways stayed on the map, trench touches opened the correct trench, and both map-return routes reused fresh previews. Cold-start checks included 1.25×, 2× and 3× display densities. At 375 × 667 with a 3× display, the game used the configured 698 × 930 backing surface. Changing one centre-row column matched a fresh profile to within 2/255 in Chromium and exactly in WebKit.

Reproduce these cases with the harness below. Pass `displayWidth: 80.625` to `run()` for the phone-size fit. After setting the browser CPU rate, `lab({cpuRate: 6})` and `profile({cpuRate: 6})` time the interactive replays. `wallFidelity(80.625, "full")` checks the final scaling against its area reference. Each function is available on `TrenchPreviewBenchmark`. [Paired raw samples and browser checks](iso-preview-comparison.json)

## October baseline

Measured on 12 October 2026 with Chrome 155 on an Apple M4 Pro (24 GiB). These are browser CPU-throttling measurements, not physical mobile-device or battery measurements. The renderer uses Full 512×256 or Lite 256×128 previews.

## Repeated measurements after cooperative cancellation

Each cell is median / 95th percentile in milliseconds, with 20 forced terrain rebuilds after three warm-ups. The deterministic deep checkerboard has 400 separate equal-depth regions and 760 cardinal height boundaries.

| Main-thread CPU setting | Full active rendering | Lite active rendering |
|---|---:|---:|
| 1× | 51.3 / 52.1 | 6.9 / 7.3 |
| 4× | 216.5 / 225.5 | 27.6 / 28.8 |
| 6× | 319.6 / 342.1 | 41.6 / 44.3 |

The approved plan's earlier baseline was 55.7 / 57.0, 206.6 / 212.0 and 317.9 / 323.9 ms Full; Lite was 7.5 / 7.7, 27.2 / 28.0 and 42.9 / 45.1 ms. The repeat is similar, with ordinary run-to-run variation.

| Other terrain, 6× main thread | Full active rendering | Lite active rendering |
|---|---:|---:|
| Deep irregular mosaic | 298.7 / 310.2 | 41.9 / 43.1 |
| Completely deep floor | 329.3 / 338.0 | 42.8 / 44.7 |
| Isolated cliffs, 0/16 checkerboard | 105.6 / 109.7 | 7.6 / 9.2 |
| Deep comb | 314.4 / 329.5 | 43.8 / 47.2 |

| Cooperative worker, checkerboard | Full active / total median | Lite active / total median |
|---|---:|---:|
| Main thread 1× | 50.9 / 51.4 | 6.8 / 7.0 |
| Main thread 4× | 54.1 / 54.7 | 7.4 / 7.9 |
| Main thread 6× | 54.7 / 55.5 | 7.3 / 7.8 |

Full worker chunks were approximately 8.3 ms (8.4 ms p95 for the largest chunk per request). These worker results do **not** represent a slowed mobile processor: Chrome's throttle suspends the main thread, and the worker remains largely unaffected. 4× and 6× are the documented Device Mode multipliers, not machine-calibrated performance presets. See [Chrome's throttling explanation](https://developer.chrome.com/blog/devtools-grounded-real-world) and [Device Mode throttling](https://developer.chrome.com/docs/devtools/device-mode#throttle).

At 6×, the actual sliced fallback delivered a checkerboard in **582.7 / 599.8 ms Full** and **85.6 / 88.2 ms Lite**. Active rendering was 296.9 / 303.9 ms and 40.2 / 41.9 ms respectively; the difference is time yielding to the event loop. Largest slices per request were 6.7 / 7.5 ms Full and 4.9 / 5.2 ms Lite. The four-ms budget is approximate because an individual generator step cannot be interrupted.

Find-only recomposition reused committed terrain. At 6× its Full median / p95 was 1.1 / 1.8 ms; Lite was below reliable timer resolution (0.0 / 1.1 ms). Raw samples, per-job chunk maxima and metadata are retained in [iso-preview-benchmark-results.json](iso-preview-benchmark-results.json). No inference about power use, thermal behaviour or mobile CPU boost is made.

## Fixtures and reproduction

[tests/fixtures/iso-adversarial-terrain.js](../tests/fixtures/iso-adversarial-terrain.js) defines 20×20 fields with max depth 16. Four-connected regions and right/down height boundaries count each logical edge once. The fixture keeps authoritative stratigraphy and six catalogue finds at their recorded positions and burial depths, with revealed exposure so composition and terrain occlusion are exercised.

| Fixture | Depth function at x, y | Regions | Boundaries |
|---|---|---:|---:|
| `deep-checkerboard` | parity of x+y selects 14 or 16 | 400 | 760 |
| `deep-mosaic` | 12 + unsigned XOR hash of x×73856093 and y×19349663, modulo 5 | 258 | 615 |
| `deep-floor` | 16 everywhere | 1 | 0 |
| `cliff-checkerboard` | parity of x+y selects 0 or 16 | 400 | 760 |
| `deep-comb` | (x+2y) modulo 3 selects 16 or 13 | 148 | 508 |

Serve the repository, then open a **disposable game tab**, preserving any tab holding excavation progress. In that tab's DevTools console load the harness:

```js
for (const url of [
  "./tests/fixtures/iso-adversarial-terrain.js",
  "./scripts/benchmark-trench-previews.js"
]) (0, eval)(await (await fetch(url)).text());
```

Set CPU throttling to 1×, 4× or 6× before each case. The `cpuRate` parameter records the selected rate; it does not change browser throttling. Run one case at a time:

```js
await TrenchPreviewBenchmark.run({
  pattern: "deep-checkerboard", quality: "full", mode: "sync", cpuRate: 6
});
```

Use `quality: "lite"`, the other fixture names, and `mode: "worker"` or `"fallback"` for the corresponding paths. Add `findOnly: true` to build terrain once before timing composition alone. Keep the defaults of three warm-ups and 20 measured samples. Terrain revisions increment each ordinary sample to bypass caching while retaining a warm engine, worker and glyph cache. Synchronous and worker timings start after immutable snapshot preparation; fallback total latency follows the real pipeline, including its snapshot creation. Worker startup is excluded by warm-ups. The median averages the two middle samples; p95 is the nearest-rank nineteenth sample of twenty. Reset throttling and close the disposable tab afterwards.

## Behaviour verification

`tests/trench-preview.test.js` exercises dirty state, Off/On scheduling, held and exposure-only presses, lab cleaning, queued work, urgent map entry, quality changes, late delivery, cancellation acknowledgements, watchdog expiry and fallback cancellation. `tests/trench-preview-worker.test.js` runs the real worker and renderer with a deterministic event queue and clock, cancelling during construction and both cached and rebuilt find composition. It checks that previous geometry survives and cancelled continuations cannot restart work. The full project check also covers both map-return routes, cache reuse and responsive selection geometry.

The browser smoke check confirmed zero dispatches for Off while held and after release, zero for On while held and before 250 ms, then exactly one after the delay. Lab entry prepared the latest changed trench first and completed two dirty previews while a cleaning pointer action remained active; map return dispatched no further jobs. Renewed excavation during a real worker job produced a cancellation acknowledgement, retained dirty state, kept the worker alive and recovered through the urgent map gate without fallback. Desktop and 375-pixel portrait layouts were inspected, with no new preview builds after resizing and no browser console errors. All 172 tests and structural checks passed.
