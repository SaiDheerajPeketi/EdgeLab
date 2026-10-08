// Independent OHLC/ledger expectations for persistent full-percentage exits.
// Orders are authored once; subsequent entries do not reissue the exit.
export const bars68 = [
  { open: 100, high: 102, low: 98, close: 100 },
  { open: 100, high: 110, low: 80, close: 105 },
  { open: 105, high: 110, low: 99, close: 108 },
  { open: 112, high: 120, low: 110, close: 118 },
].map((bar, index) => ({ ...bar, time: 1700000040 + index * 60, volume: 100 + index }));
export const context68 = { symbol: "TEST", timeframe: "1", mintick: 1, pointvalue: 1 };
export function program68({ sizing = "qty_percent=100", short = false, before = "", after = "", scope = "", laterId = "C", version = 6 } = {}) {
  return `//@version=${version}
strategy("Persistent full exits",initial_capital=10000,pyramiding=3,calc_on_order_fills=true)
varip int calls=0
varip int previous=-1
if bar_index!=previous
    previous:=bar_index
    calls:=0
calls+=1
if bar_index==0
    strategy.entry("A",strategy.${short ? "short" : "long"},qty=2)
if bar_index==1 and calls==1
    strategy.entry("B",strategy.${short ? "short" : "long"},qty=2)
if bar_index==1 and calls==3
${before}    strategy.exit("X",${scope}profit=5${sizing ? "," + sizing : ""})
if bar_index==2 and calls==1
${after}    strategy.entry("${laterId}",strategy.${short ? "short" : "long"},qty=2)
plot(calls,"Calls")
plot(calls[1],"Prior calls")
plot(strategy.position_size,"Position")
plot(high,"Final high")`;
}
const rows = [["A", 100, 105, 2, 10, 1, 2], ["B", 110, 115, 2, 10, 1, 3], ["C", 110, 115, 2, 10, 2, 3]];
const normal = { closed: rows, open: [], position: [0, 4, 4, 0], profit: 30 };
export const cases68 = [
  { name: "explicit 100% covers initial and later long entries", source: program68(), bars: bars68, expected: normal },
  { name: "omitted full sizing retains the same long ledger", source: program68({ sizing: "" }), bars: bars68, expected: normal },
  { name: "Pine v5 explicit full exit persists", source: program68({ version: 5 }), bars: bars68, expected: normal },
  { name: "resolved input supplies full percentage", source: program68({ sizing: 'qty_percent=input.int(100,"Exit percent",minval=1,maxval=100)' }), bars: bars68, expected: normal },
  { name: "short full exit covers the later physical lot", source: program68({ short: true }), bars: bars68.map(bar => ({ ...bar, open: 200-bar.open, high: 200-bar.low, low: 200-bar.high, close: 200-bar.close })), expected: {
    closed: [["A",100,95,-2,10,1,2],["B",90,85,-2,10,1,3],["C",90,85,-2,10,2,3]], open: [], position: [0,-4,-4,0], profit: 30,
  } },
  { name: "cancel releases the later-entry lifetime", source: program68({ after: '    strategy.cancel("X")\n' }), bars: bars68, expected: { closed: rows.slice(0,1), open: [["B",110,2],["C",110,2]], position: [0,4,4,4], profit: 10 } },
  { name: "cancel all releases the later-entry lifetime", source: program68({ after: '    strategy.cancel_all()\n' }), bars: bars68, expected: { closed: rows.slice(0,1), open: [["B",110,2],["C",110,2]], position: [0,4,4,4], profit: 10 } },
  { name: "replacement full exit preserves a new generation's price", source: program68({ after: '    strategy.exit("X",profit=10,qty_percent=100)\n' }), bars: bars68, expected: { closed: [rows[0],["B",110,120,2,20,1,3],["C",110,120,2,20,2,3]], open: [], position: [0,4,4,0], profit: 50 } },
  { name: "earlier reserved quantity remains unavailable to full exit", source: program68({ before: '    strategy.exit("Reserved","A",profit=100,qty=1)\n' }), bars: bars68, expected: { closed: [["A",100,105,1,5,1,2],...rows.slice(1)], open: [["A",100,1]], position: [0,4,5,1], profit: 25, pending: ["Reserved"] } },
  { name: "scoped full percentage excludes a later same-ID entry", source: program68({ scope: '"B",', laterId: "B" }), bars: bars68, expected: { closed: [rows[1]], open: [["A",100,2],["B",112,2]], position: [0,4,4,4], profit: 10 } },
  { name: "positive fixed qty wins over explicit 100 percent for each entry", source: program68({ sizing: "qty=1,qty_percent=100" }), bars: bars68, expected: {closed:[["A",100,105,1,5,1,2],["B",110,115,1,5,1,3],["C",110,115,1,5,2,3]],open:[["A",100,1],["B",110,1],["C",110,1]],position:[0,4,5,3],profit:15} },
  { name: "partial percentages cover later entries without consuming old remainders", source: program68({ sizing: "qty_percent=50" }), bars: bars68, expected: {closed:[["A",100,105,1,5,1,2],["B",110,115,1,5,1,3],["C",110,115,1,5,2,3]],open:[["A",100,1],["B",110,1],["C",110,1]],position:[0,4,5,3],profit:15} },
];
const reopen = `//@version=6
strategy("Exit lifetime",initial_capital=10000,calc_on_order_fills=true)
varip bool exited=false
varip bool reopened=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)
if strategy.position_size>0 and not exited
    exited:=true
    strategy.exit("X",profit=5,qty_percent=100)
if strategy.position_size==0 and strategy.closedtrades==1 and not reopened
    reopened:=true
    strategy.entry("B",strategy.long,qty=1)
plot(strategy.position_size,"Position")`;
cases68.push({ name: "flat completion retires the exit before a reopened position", source: reopen, bars: bars68.slice(0,3), expected: { closed: [["A",100,105,1,5,1,1]], open: [["B",110,1]], position: [0,1,1], profit: 5 } });
export function ledger68(result) {
  return {
    closed: result.strategy.closedTrades.map(t => [t.entry_id,t.entry_price,t.exit_price,t.size,t.profit,t.entry_bar_index,t.exit_bar_index]),
    open: result.strategy.openTrades.map(t => [t.entry_id,t.entry_price,t.size]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]),
    position: result.plots.find(p => p.name === "Position").points.map(p => p.value),
    profit: result.strategy.metrics.netprofit,
    pending: result.strategy.pendingOrders.map(o => o.id),
  };
}

cases68.push({
  name: "dormant full exit resumes for a later entry while another exit holds a lot",
  source: program68({ before: '    strategy.exit("Reserved","A",profit=100,qty=1)\n' }) + '\nif bar_index==3 and calls==3\n    strategy.entry("D",strategy.long,qty=2)',
  bars: [...bars68,{ open:118,high:125,low:115,close:120,time:bars68[3].time+60,volume:104 }],
  expected: { closed: [["A",100,105,1,5,1,2],...rows.slice(1),["D",118,123,2,10,4,4]], open: [["A",100,1]], position: [0,4,5,1,1], profit: 35, pending: ["Reserved"] },
});
for (const enabled of [false,true]) {
  cases68.push({
    name: `cancel all removes pending entries, brackets and market closes with fill recalculation ${enabled}`,
    source: `//@version=6
strategy("Cancel all order types",initial_capital=10000,pyramiding=3,calc_on_order_fills=${enabled})
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
if bar_index==1
    strategy.entry("Never filled",strategy.long,qty=2,limit=95)
    strategy.exit("Bracket","A",limit=105,stop=75)
    strategy.close("A")
    strategy.cancel_all()
plot(strategy.position_size,"Position")`,
    bars: bars68,
    expected: { closed: [], open: [["A",100,2]], position: [0,2,2,2], profit: 0 },
  });
}
