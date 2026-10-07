# EdgeLab v2 reviewed community migrations

These eight GPL-3.0 derivatives retain Alex Orekhov (everget)'s original formulas, plots, titles, defaults, author and licence notices. The verbatim originals are independently pinned in the expanded collection; imported copies retain both hashes.

Pine v3/v4 study becomes indicator, inputs are typed and built-ins are namespaced. Legacy color names are made explicit, and removed transp arguments use a helper that preserves already-transparent colors. Legacy v4 named RGB colors are also pinned explicitly: the installed v5 runtime uses newer named-color values, so keeping the names would change the authored colors. No formula or input range has been redesigned. Momentum and Rate of Change are the author's fixed close/7 research comparisons, with four distinct plots and no inputs. Price Volume Trend preserves its declared but unused Source input and built-in PVT calculation.

The local runtime's initialization, missing-value, drawing and alert behavior is bounded by its current implementation. These migrations do not prove TradingView equivalence. Pine alert conditions are not connected to notifications. Changes to upstream revision, source bytes or version require a new reviewed derivative; refresh never regenerates them. Existing v1 derivatives and the original archive remain unchanged.
