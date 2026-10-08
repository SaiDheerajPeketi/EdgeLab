export const context69 = { symbol: "BINANCE:TESTUSDT", timeframe: "1", mintick: 0.03, pointvalue: 1, mincontract: 0.05, quantityStep: 0.025, currency: "USDT", basecurrency: "TEST" };
export const bars69 = [
  { open:100, high:103, low:97, close:100 },
  { open:100, high:110, low:95, close:105 },
  { open:105, high:120, low:100, close:115 },
].map((bar,index) => ({ ...bar,time:1700000040+index*60,volume:100 }));
const source = ({qty="0.075", settings="", fills=false}={}) => `//@version=6
strategy("Fractional sizing",initial_capital=1000,calc_on_order_fills=${fills}${settings})
if bar_index==0
    strategy.entry("A",strategy.long${qty===null ? "" : ",qty="+qty})
if bar_index==1 and strategy.position_size>0
    strategy.close("A")
plot(strategy.position_size,"Position")`;
const normal={closed:[["A",100,105,0.075,0.375,1,2]],open:[],position:[0,0.075,0],profit:0.375,pending:[]};
const empty={closed:[],open:[],position:[0,0,0],profit:0,pending:[]};
export const cases69 = [
  {name:"distinct minimum and increment preserve a valid 0.075 position",source:source(),expected:normal},
  {name:"non-grid explicit size floors to 0.075",source:source({qty:"0.099"}),expected:normal},
  {name:"grid-valid size below minimum does not enter",source:source({qty:"0.025"}),expected:empty},
  {name:"rounded quantity below minimum does not enter",source:source({qty:"0.049"}),expected:empty},
  {name:"default fixed sizing floors to the actual increment",source:source({qty:null,settings:",default_qty_type=strategy.fixed,default_qty_value=0.099"}),expected:normal},
  {name:"cash sizing retains fractional units",source:source({qty:null,settings:",default_qty_type=strategy.cash,default_qty_value=7.5"}),expected:normal},
  {name:"equity percentage retains fractional units",source:source({qty:null,settings:",default_qty_type=strategy.percent_of_equity,default_qty_value=0.75"}),expected:normal},
  {name:"fill recalculation closes fractional units on the next historical tick",source:source({fills:true}),expected:{...empty,closed:[["A",100,95,0.075,-0.375,1,1]],profit:-0.375}},
  {name:"scientific notation increments preserve their decimal grid",source:source({qty:"0.00000075"}),context:{...context69,mincontract:0.00000025,quantityStep:0.00000025},expected:{...normal,closed:[["A",100,105,0.00000075,0.00000375,1,2]],position:[0,0.00000075,0],profit:0.00000375}},
];
export const info69 = `//@version=6
indicator("Actual symbol information")
plot(syminfo.mincontract,"Minimum")
plot(syminfo.mintick,"Tick")
plot(syminfo.minmove,"Move")
plot(syminfo.pricescale,"Scale")
plot(syminfo.pointvalue,"Point")
plot(syminfo.currency=="USDT"?1:0,"Quote")
plot(syminfo.basecurrency=="TEST"?1:0,"Base")`;
export function ledger69(result) {
  const rounded=value=>typeof value==="number"?Number(value.toPrecision(12)):value;
  return {closed:result.strategy.closedTrades.map(t=>[t.entry_id,t.entry_price,t.exit_price,t.size,t.profit,t.entry_bar_index,t.exit_bar_index].map(rounded)),
    open:result.strategy.openTrades.map(t=>[t.entry_id,t.entry_price,t.size].map(rounded)),
    position:result.plots.find(p=>p.name==="Position").points.map(p=>rounded(p.value)),profit:rounded(result.strategy.metrics.netprofit),pending:result.strategy.pendingOrders.map(o=>o.id)};
}
