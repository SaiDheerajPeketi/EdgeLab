# EdgeLab Glossary

EdgeLab combines concepts from software engineering and professional trading. This glossary defines domain-specific terms used throughout the codebase and documentation to help non-trader engineers understand the business logic.

## Application Concepts

- **Playbook**: EdgeLab's term for a trading strategy. A playbook defines the setup criteria, rules, and parameters a trader uses to enter and exit a market. Trades in EdgeLab are tagged against playbooks to calculate strategy-level performance metrics.
- **Session (Backtest Session)**: An isolated simulation environment where a trader replays historical market data as if it were live. Each session tracks its own balance, active orders, open positions, and resulting closed trades.
- **Replay / Replay-Candles**: The act of rendering historical market data one candle at a time to simulate real-time trading without looking ahead. EdgeLab's frontend requests new "replay candles" sequentially during a backtest session.
- **Manifest**: Refers to `.edgelab-data-populator-manifest.json`, a state file used by the data populator to track the start/end dates and missing gaps of downloaded historical data, ensuring the populator knows where to resume.
- **Data Populator**: The background worker process responsible for querying external data feeds (Binance, Dukascopy), generating missing candles, and storing them in the `datasets/` volume and TimescaleDB.

## Trading Concepts

- **Candle / Candlestick (OHLC)**: A graphical representation of price movement over a specific time period. Each candle contains the Open, High, Low, and Close prices for that period.
- **Timeframes (e.g. M1, M5, H1, Daily)**: The duration a single candle represents.
  - **M1**: 1-Minute
  - **M5**: 5-Minute
  - **M15**: 15-Minute
  - **M30**: 30-Minute
  - **H1**: 1-Hour
  - **H4**: 4-Hour
- **Order**: A pending request to buy or sell an asset at a specific price. EdgeLab supports Market, Limit, and Stop orders.
- **Position**: An active, open exposure in the market (e.g., currently holding a purchased asset). A position is created when an Order is filled, and is closed when the asset is sold.
- **Trade**: The complete historical record of a Position from the moment it was opened until it was fully closed. Trades are the primary entity journaled and analyzed for metrics in EdgeLab.
- **TP (Take Profit)**: A target price at which an open position is automatically closed to lock in a gain.
- **SL (Stop Loss)**: A target price at which an open position is automatically closed to prevent further losses.
- **Breakeven Stop**: Moving a Stop Loss to the original entry price so that, even if the market reverses, the trade will close with zero loss.
- **Long / Short**:
  - **Long**: Buying an asset with the expectation that its price will rise.
  - **Short**: Selling a borrowed asset with the expectation that its price will fall, aiming to buy it back cheaper later.
- **Equity Curve**: A chart plotting the cumulative balance of a trading account over time. Used in EdgeLab's metrics to visualize the performance of a session or playbook.
