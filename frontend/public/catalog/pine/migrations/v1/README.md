# Everget compatibility migrations, revision 1

These 17 GPL-3.0 Pine v5 derivatives are separate from the exact upstream originals. They are community-source compatibility migrations prepared for EdgeLab, not upstream revisions or official TradingView scripts. Copyright and distribution notices by Alex Orekhov (everget) remain in every source. The unchanged upstream [GPL-3.0 licence](LICENSE.txt) accompanies this directory.

The original base is `everget/tradingview-pinescript-indicators` commit `0b164e1e4f2fb7b06524c6d0a26e6132228c9448`. Original bytes remain under `../../everget/0b164e1e4f2fb7b06524c6d0a26e6132228c9448/`. The compiled migration manifest pins catalog ID/path, original version/commit/blob/SHA-256, derivative ID/version/path/bytes/SHA-256. Loading or editing a derivative must never label it an unchanged original.

## Conversion policy

The official [v3→v4 migration guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-4/) documents namespace and style-constant renames. The official [v4→v5 guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/) documents `indicator`, typed inputs, technical-analysis/math namespaces and explicit transparency. Each derivative applies those changes to its actual calls; changing only the version header is insufficient.

Titles, short titles, overlay/precision settings, input labels/order/defaults/minimums/maximums/options, formulas, branches and signal calls are retained. No signal or unsupported visual call is removed. Inputs use `input.int/float/bool/source/string`; old integer-only function parameters receive explicit integer conversions where necessary. Hull's half-window is truncated, while its square-root window is rounded. KAMA's input-derived smoothing fractions remain fractional. The [official integer-division explanation](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/#fractional-division-of-constants) distinguishes constant division from input/series division; these migrations do not apply a blanket truncation rule.

Legacy `transp=0` is removed. Nonzero transparency becomes `_legacyTransparency`: `na` remains absent, a color already containing transparency remains unchanged, and an opaque color receives `color.new`. This retains the original transparent fallback rather than turning it into a visible fill. The [v4 color guide](https://www.tradingview.com/pine-script-docs/v4/essential/colors/) documents that an existing color alpha takes precedence over `transp`. Named colors used by these originals are pinned to documented v4/v5 RGB literals: red `#FF5252`, green `#4CAF50`, purple `#9C27B0`, white `#FFFFFF`. This avoids the pinned engine's current palette changing a v5 derivative; [TradingView documents the v6 palette change](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/#color-changes). Existing literal colors are unchanged.

## Source-by-source changes and native execution

All rows passed preparation and their listed executions through EdgeLab's actual native worker using PineTS 0.11.0 and the same 512-bar oscillating OHLCV fixture. Executions cover defaults, each changed input, both OBV/TRIX smoothing choices and every declared RSI/CCI source alias. The evidence fixture uses `close=100+sin(i/8)*12`, `open=close−cos(i/3)*0.7`, high/low=close±1, volume=100+i, time=1700000040+i*60, with TEST/1-minute context, mintick0.01 and pointvalue1. Counts include configured null/hidden/fill/background channels; they are not TradingView plot-count units.

| Derivative | Original→target | Inputs | Channels | Runs | Preserved behavior and changes |
| --- | --- | ---: | ---: | ---: | --- |
| [movings/hull_moving_average.pine](movings/hull_moving_average.pine) | 3→5 | 2 | 1 | 4 | Retains the custom Hull formula. Explicit int(length / 2) preserves the legacy WMA half-window; the square-root window remains rounded, not floored. |
| [movings/exponential_moving_average.pine](movings/exponential_moving_average.pine) | 3→5 | 2 | 1 | 4 | Retains the EMA formula, source default close and length 14/minimum 1. |
| [movings/simple_moving_average.pine](movings/simple_moving_average.pine) | 3→5 | 2 | 1 | 4 | Retains the SMA formula, source default close and length 14/minimum 1. |
| [movings/weighted_moving_average.pine](movings/weighted_moving_average.pine) | 3→5 | 2 | 1 | 4 | Retains the WMA formula, source default close and length 14/minimum 1. |
| [movings/double_exponential_moving_average.pine](movings/double_exponential_moving_average.pine) | 3→5 | 2 | 1 | 4 | Retains both nested EMA calls and 2*EMA1−EMA2; no substitution with a different built-in. |
| [movings/t3_moving_average.pine](movings/t3_moving_average.pine) | 4→5 | 4 | 1 | 6 | Inlines three generalized-DEMA stages at distinct EMA callsites; retains stage-by-stage SMA warmup, factor 0.7 and directional highlighting. The pinned engine shares state for the original nested user-function form. |
| [movings/kaufman_adaptive_moving_average.pine](movings/kaufman_adaptive_moving_average.pine) | 4→5 | 5 | 1 | 7 | Retains efficiency ratio, rolling absolute changes, fractional input-derived EMA coefficients, squared smoothing coefficient and nz(kama[1],src) recursion. |
| [movings/arnaud_legoux_moving_average.pine](movings/arnaud_legoux_moving_average.pine) | 3→5 | 4 | 1 | 6 | Retains ALMA length 9, offset 0.85, sigma 6 and source close. |
| [movings/zero_lag_exponential_moving_average.pine](movings/zero_lag_exponential_moving_average.pine) | 4→5 | 3 | 1 | 5 | Retains floor((length−1)/2), source lag compensation and EMA, including directional highlighting. |
| [oscillators/rsi_relative_strength_index.pine](oscillators/rsi_relative_strength_index.pine) | 3→5 | 5 | 9 | 24 | Retains RSI, all 20 source aliases, thresholds, five levels and three fills; transparent fallback stays transparent. |
| [oscillators/stochastic.pine](oscillators/stochastic.pine) | 4→5 | 13 | 15 | 15 | Retains smoothed K/D, histogram toggle, thresholds, four fills, background and both absolute crossover circles. |
| [oscillators/cci_commodity_channel_index.pine](oscillators/cci_commodity_channel_index.pine) | 3→5 | 7 | 9 | 27 | Retains the explicit CCI equation, all 21 source aliases, levels, fills and alertcondition calls. The original PVT alias uses roc(src,1) while local src starts at0; that unusual formula is preserved, not repaired. |
| [oscillators/mfi_money_flow_index.pine](oscillators/mfi_money_flow_index.pine) | 4→5 | 12 | 15 | 13 | Retains ta.mfi(src,length), EMA signal, histogram, levels, fills, titled background and absolute crossover circles. |
| [volume/on_balance_volume.pine](volume/on_balance_volume.pine) | 3→5 | 6 | 5 | 8 | Retains cum(sign(change(src))*volume), both signal smoothing choices, visibility/highlight toggles, fill and absolute circles. |
| [oscillators/awesome_oscillator.pine](oscillators/awesome_oscillator.pine) | 3→5 | 2 | 1 | 3 | Retains the two SMA lengths 5/34, hl2 source, column style and four literal histogram colors. |
| [oscillators/percentage_price_oscillator.pine](oscillators/percentage_price_oscillator.pine) | 3→5 | 5 | 4 | 7 | Retains 100*(fastEMA−slowEMA)/slowEMA, signal EMA, histogram and optional fill. |
| [oscillators/trix.pine](oscillators/trix.pine) | 3→5 | 10 | 8 | 12 | Retains triple EMA, ROC multiplier, both signal smoothing choices, histogram/zero-background toggles, fill and absolute circles. |

Total: 17 preparations, 153 successful executions, 86 input definitions. These checks establish native execution and metadata preservation, not complete numerical or pixel parity against TradingView's historical v3/v4 engine. The repo's independent migration tests provide additional formula/branch coverage.

The T3 derivative deliberately inlines the original three generalized-DEMA stages. An independent formula oracle exposed PineTS 0.11.0 sharing EMA state across the nested `_gd` callsites: length 5 became finite at bar 8 instead of bar 24. Separate source callsites preserve the original stage order and stage-by-stage SMA seeding. This is a derivative-local workaround, not a correction to the engine. A six-EMA polynomial rewrite was avoided because it changes startup behavior.

## Remaining runtime limits

- Stochastic, MFI and TRIX retain native `bgcolor` output. The current chart adapter visibly warns that background output is unsupported; the derivative does not omit it.
- CCI retains its two `alertcondition` calls. This host does not deliver TradingView alerts.
- CCI's original “price volume trend” source alias is intentionally unusual and may yield no finite CCI output. No close-based formula is silently substituted.
- Empty/hidden channels remain part of the native result. Hline color/style defaults, dash/dot spacing, shape fonts/sizes and histogram column widths carry the existing local-renderer calibration disclosures. Hline-reference fill geometry in future whitespace is not extrapolated from the last known shade.
- Supplied bars are closed historical snapshots. Exchange sessions, realtime ticks/rollback, external market requests and TradingView-side editor/style controls are not reproduced by these derivative sources.

## Append-only maintenance

Revision1 source URLs are immutable. Retain every reviewed migration entry, source asset and original pin when refreshing the upstream catalog. Add a new revision directory and new reviewed hash/pin entry for a changed migration; do not overwrite these bytes or discard historical entries. Saved migration provenance must resolve its exact historical base and derivative hashes, even after the current original catalog advances. Updating an original source does not silently authorize an older migration for that new revision.
