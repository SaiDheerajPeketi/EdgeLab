import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const compiled = (await build({ bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent", define: { "import.meta.env.DEV": "true" }, plugins: [{ name: "journal207", setup(api) {
  api.onResolve({ filter: /^react$|^react\/jsx-runtime$|^\.\/JournalControls$|^\.\/ThemedSelect$/ }, args => ({ path: args.path, namespace: "journal207" }));
  api.onLoad({ filter: /.*/, namespace: "journal207" }, ({ path }) => ({ loader: "js", contents: path === "react"
    ? "export const useMemo=fn=>fn();export const useState=value=>globalThis.journal207.state(value);export const useEffect=()=>{};export const useRef=value=>({current:value});"
    : path === "react/jsx-runtime" ? "export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';"
    : "export const JournalButton='button';export const JournalEmpty='empty';export const ThemedSelect='select';" }));
} }], stdin: { loader: "ts", resolveDir: process.cwd(), contents: `export {LocalDemoLivePage} from './frontend/src/components/LocalDemoLivePage';export {JournalPracticeSurface,journalStrategyEvidence} from './frontend/src/components/journal/JournalPracticeSurface';export {isLocalDemoSession,localDemoReplaySessions,bindLocalDemoPanes} from './frontend/src/lib/localDemoPreview';` } })).outputFiles[0].text;
const module = { exports: {} }; new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
const api = module.exports;
const text = node => (typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node?.props?.children ?? "")).replace(/\s+/g, " ");
const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const trade = (id, extra = {}) => ({ id, account_id: 1, strategy_name: "Opening range", symbol: "ES", side: "LONG", entry_time: "2026-10-10T10:00:00Z", status: "CLOSED", gross_pnl: 12, net_pnl: 10, commission: 1, fees: 1, r_multiple: 1, reviewed: true, currency: "USD", ...extra });
function view(props) { let i = 0; const state = []; globalThis.journal207 = { state: value => { const index = i++; state[index] ??= { value }; return [state[index].value, next => { state[index].value = next; }]; } }; return { render: () => { i = 0; return api.JournalPracticeSurface(props); } }; }
const base = () => ({ sessions: [{ id: 3, name: "Afternoon replay", symbol: "ES", timeframe: "M1", strategy_name: "Opening range", status: "ACTIVE", start_offset: 0, current_offset: 180, end_offset: 999, currency: "USD", realized_pnl: 35, replay_ready: true }], playbooks: [{ id: 2, name: "Opening range", rules: "Wait for confirmation. Risk at most 1%.", description: "Morning plan" }], accounts: [{ id: 1, currency: "USD" }], trades: [trade(1), trade(2, { net_pnl: -4, reviewed: false }), trade(3, { strategy_name: "Other", status: "OPEN", net_pnl: 999 })], onOpenTrade() {} });

test("actual journal surfaces show distinct sessions, trading rules and scoped strategy evidence; trade drill-down opens exact records", () => {
  const props = base(); const opened = []; props.onOpenTrade = row => opened.push(row.id);
  const sessions = view({ ...props, kind: "sessions" }).render(); assert.match(text(sessions), /Afternoon replay/); assert.doesNotMatch(text(sessions), /Wait for confirmation/);
  const books = view({ ...props, kind: "playbooks" }); let tree = books.render(); assert.match(text(tree), /Wait for confirmation/); assert.match(text(tree), /2 trades recorded with this name/); assert.doesNotMatch(text(tree), /Afternoon replay/);
  walk(tree).find(node => node.props?.onClick && /Review matching trades/.test(text(node))).props.onClick(); tree = books.render();
  const rows = walk(tree).filter(node => node.type === "button" && /Awaiting review|Reviewed/.test(text(node))); assert.equal(rows.length, 2); rows[1].props.onClick(); assert.deepEqual(opened, [2]);
  const strategy = view({ ...props, kind: "strategies" }).render(); assert.match(text(strategy), /Win rate/); assert.match(text(strategy), /USD 6/); assert.doesNotMatch(text(strategy), /Wait for confirmation/);
});

test("strategy summaries exclude unrealized P&L and keep exact evidence groups without assigning unnamed trades to a playbook", () => {
  const rows = api.journalStrategyEvidence([trade(1), trade(2, { status: "OPEN", net_pnl: 10000 }), trade(3, { strategy_name: null })]);
  assert.equal(rows[0].summary.netPnl, 10); assert.equal(rows[0].summary.closedTrades, 1); assert.deepEqual(rows[0].trades.map(row => row.id), [1, 2]); assert.equal(rows[1].name, "Unassigned");
  const props = base(); props.trades.push(trade(4, { account_id: 2, currency: "EUR" })); props.accounts.push({ id: 2, currency: "EUR" });
  assert.match(text(view({ ...props, kind: "strategies" }).render()), /Mixed currencies/);
});

test("session Resume invokes the actual selected session callback and reports failed opening without claiming success", async () => {
  const called = [], h = view({ ...base(), kind: "sessions", onResumeSession: async id => { called.push(id); throw new Error("Offline"); } });
  walk(h.render()).find(node => node.props?.onClick && /Resume replay/.test(text(node))).props.onClick();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(called, [3]); assert.match(text(h.render()), /could not be opened.*Try Resume again/);
});

test("synthetic preview admission requires development loopback, explicit opt-in and exact disposable beta identity; normal accounts remain external", () => {
  const previous = globalThis.window;
  const user = { deploymentMode: "beta", email: "developer@localhost.edgelab", name: "Demo data" };
  globalThis.window = { location: { hostname: "localhost", search: "?preview=demo" }, sessionStorage: { getItem: () => null } };
  try {
    assert.equal(api.isLocalDemoSession(user), true);
    for (const extra of [{ deploymentMode: "production" }, { email: "real@example.test" }, { name: "Local developer" }]) assert.equal(api.isLocalDemoSession({ ...user, ...extra }), false);
    window.location.hostname = "edgelab.example"; assert.equal(api.isLocalDemoSession(user), false); window.location.hostname = "localhost";
    window.location.search = ""; assert.equal(api.isLocalDemoSession(user), false); window.sessionStorage.getItem = () => "1"; assert.equal(api.isLocalDemoSession(user), true);
    assert.deepEqual(api.localDemoReplaySessions([{ id: 1, name: "Demo · One", replay_ready: true }, { id: 2, name: "Real account", replay_ready: true }, { id: 3, name: "Demo · Missing", replay_ready: false }]).map(row => row.id), [1]);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; delete globalThis.journal207; }
});


test("demo pane binding preserves layout/indicator settings and foreign drawing ownership without mislabeling synthetic candles", () => {
  const foreign = { id: "btc-zone", points: [{ time: 100, price: 65000 }] }, local = { id: "es-zone", points: [{ time: 100, price: 5600 }] };
  const panes = [{ id: "one", symbol: "BINANCE:BTCUSDT", timeframe: "1m", drawings: [foreign], drawingsByMarket: { ES: [local] }, indicators: ["RSI"] }, { id: "two", symbol: "EURUSD", timeframe: "5m", drawings: [], drawingsByMarket: {} }];
  const bound = api.bindLocalDemoPanes(panes, "ES");
  assert.deepEqual(bound.map(pane => pane.symbol), ["ES", "ES"]); assert.deepEqual(bound.map(pane => pane.timeframe), ["1m", "5m"]); assert.deepEqual(bound[0].indicators, ["RSI"]);
  assert.deepEqual(bound[0].drawings, [local]); assert.deepEqual(bound[0].drawingsByMarket["BINANCE:BTCUSDT"], [foreign]); assert.deepEqual(panes[0].drawings, [foreign]); assert.equal(panes[0].drawingMarket, undefined);
  const reloaded = api.bindLocalDemoPanes(bound, "ES"); assert.equal(reloaded[0], bound[0]); assert.equal(reloaded[1], bound[1]);
});


test("practice lists and drilled trades keep 100-row windows, navigate all records and reset or clamp after scope/data changes", () => {
  const click = (tree, label) => { const button = walk(tree).find(node => node.props?.onClick && text(node) === label); assert.ok(button, label); assert.equal(Boolean(button.props.disabled), false, label); button.props.onClick(); };
  const props = { ...base(), kind: "strategies", scopeKey: "account-1", trades: Array.from({ length: 250 }, (_, index) => trade(index + 1, { strategy_name: `Plan ${String(index).padStart(3, "0")}` })) };
  const h = view(props); let tree = h.render();
  assert.equal(walk(tree).filter(node => node.type === "tr").length, 101); assert.match(text(tree), /1\s*–\s*100 of 250 strategies/);
  click(tree, "Next 100 strategies"); tree = h.render(); assert.match(text(tree), /101\s*–\s*200 of 250 strategies/); assert.doesNotMatch(text(tree), /Plan 000/);
  click(tree, "Next 100 strategies"); tree = h.render(); assert.equal(walk(tree).filter(node => node.type === "tr").length, 51); assert.match(text(tree), /201\s*–\s*250 of 250 strategies/);
  props.scopeKey = "account-2"; tree = h.render(); assert.match(text(tree), /1\s*–\s*100 of 250 strategies/);
  click(tree, "Next 100 strategies"); props.trades = props.trades.slice(0, 3); tree = h.render(); assert.match(text(tree), /1\s*–\s*3 of 3 strategies/);
  props.kind = "sessions"; props.sessions = Array.from({ length: 250 }, (_, index) => ({ ...base().sessions[0], id: index, name: `Session ${index}` })); tree = h.render(); assert.equal(walk(tree).filter(node => node.type === "article").length, 100);
  click(tree, "Next 100 sessions"); tree = h.render(); assert.match(text(tree), /101\s*–\s*200 of 250 sessions/);
  props.kind = "playbooks"; props.playbooks = Array.from({ length: 250 }, (_, index) => ({ ...base().playbooks[0], id: index, name: `Book ${index}` })); tree = h.render(); assert.equal(walk(tree).filter(node => node.type === "article").length, 100); assert.match(text(tree), /1\s*–\s*100 of 250 playbooks/);
  click(tree, "Next 100 playbooks"); tree = h.render(); assert.match(text(tree), /101\s*–\s*200 of 250 playbooks/);
  const opened = []; const drillProps = { ...base(), kind: "strategies", scopeKey: "one", trades: Array.from({ length: 250 }, (_, index) => trade(index + 1)), onOpenTrade: row => opened.push(row.id) }; const drill = view(drillProps);
  click(drill.render(), "Review trades"); tree = drill.render(); assert.equal(walk(tree).filter(node => node.type === "button" && /Awaiting review|Reviewed/.test(text(node))).length, 100);
  click(tree, "Next 100 trades"); tree = drill.render(); const row = walk(tree).find(node => node.type === "button" && /Awaiting review|Reviewed/.test(text(node))); row.props.onClick(); assert.deepEqual(opened, [101]);
  click(tree, "Next 100 trades"); tree = drill.render(); assert.match(text(tree), /201\s*–\s*250 of 250 trades/);
  drillProps.scopeKey = "two"; tree = drill.render(); assert.match(text(tree), /1\s*–\s*100 of 250 trades/);
});


test("actual synthetic Live render tolerates initial session hydration and unavailable seeds without dereferencing absent data", () => {
  globalThis.journal207 = { state: value => [value, () => {}] };
  try {
    const renderChart = () => { assert.fail("No source has been loaded"); };
    assert.match(text(api.LocalDemoLivePage({ sessions: [], renderChart })), /No seeded replay is available/);
    assert.match(text(api.LocalDemoLivePage({ sessions: [{ ...base().sessions[0], name: "Demo · Loading" }], renderChart })), /Loading demo candles/);
  } finally { delete globalThis.journal207; }
});
