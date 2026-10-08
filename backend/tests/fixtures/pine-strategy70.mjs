import { bars68, program68 } from "./pine-strategy68.mjs";
export const context70={symbol:"TEST",timeframe:"1",mintick:1,pointvalue:1};
const partial={closed:[["A",100,105,1,5,1,2],["B",110,115,1,5,1,3],["C",110,115,1,5,2,3]],open:[["A",100,1],["B",110,1],["C",110,1]],position:[0,4,5,3],profit:15,pending:[]};
export const cases70=[
 {name:"one fixed unit is allocated independently to current and later entries",source:program68({sizing:"qty=1"}),bars:bars68,expected:partial},
 {name:"fifty percent persists independently for current and later entries",source:program68({sizing:"qty_percent=50"}),bars:bars68,expected:partial},
 {name:"fixed quantity takes precedence over a full percentage",source:program68({sizing:"qty=1,qty_percent=100"}),bars:bars68,expected:partial},
 {name:"unequal entry sizes retain separate original percentage bases",source:program68({sizing:"qty_percent=25"}).replace('"A",strategy.long,qty=2','"A",strategy.long,qty=4').replace('"B",strategy.long,qty=2','"B",strategy.long,qty=8').replace('"C",strategy.long,qty=2','"C",strategy.long,qty=4'),bars:bars68,expected:{closed:[["A",100,105,1,5,1,2],["B",110,115,2,10,1,3],["C",110,115,1,5,2,3]],open:[["A",100,3],["B",110,6],["C",110,3]],position:[0,12,15,12],profit:20,pending:[]}},
 {name:"cancel stops an exhausted partial generation from covering the next entry",source:program68({sizing:"qty=1",after:'    strategy.cancel("X")\n'}),bars:bars68,expected:{closed:partial.closed.slice(0,1),open:[["A",100,1],["B",110,2],["C",110,2]],position:[0,4,5,5],profit:5,pending:[]}},
];
const staggerBars=[
 {open:100,high:102,low:98,close:100},
 {open:100,high:110,low:95,close:105},
 {open:105,high:120,low:100,close:115},
 {open:115,high:130,low:110,close:120},
].map((b,i)=>({...b,time:1700000040+i*60,volume:100}));
for(const qty of [1,2]) cases70.push({name:`scoped ${qty}-unit exits retain pending same-bar entries but exclude newer creation bars`,source:`//@version=6
strategy("Creation cutoff",initial_capital=10000,pyramiding=4,calc_on_order_fills=true)
varip bool placed=false
varip bool later=false
if bar_index==0
    strategy.entry("Buy",strategy.long,qty=2)
if strategy.position_size>0 and not placed
    placed:=true
    strategy.entry("Buy",strategy.long,qty=2,stop=115)
    strategy.exit("X","Buy",profit=5,qty=${qty})
if bar_index==2 and not later
    later:=true
    strategy.entry("Buy",strategy.long,qty=2)
plot(strategy.position_size,"Position")`,bars:staggerBars,expected:{closed:qty===1?[["Buy",100,105,1,5,1,1],["Buy",100,120,1,20,1,2]]:[["Buy",100,105,2,10,1,1],["Buy",115,120,2,10,2,2]],open:qty===1?[["Buy",100,1],["Buy",115,1],["Buy",120,2]]:[["Buy",120,2]],position:qty===1?[0,1,4,4]:[0,0,2,2],profit:qty===1?25:20,pending:[]}});
cases70.push({name:"later partial percentage uses original entry size after an earlier exit",source:`//@version=6
strategy("Original quantity",initial_capital=10000,calc_on_order_fills=true)
varip bool first=false
varip bool second=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=8)
if strategy.position_size==8 and not first
    first:=true
    strategy.exit("First","A",profit=5,qty=2)
if strategy.position_size==6 and not second
    second:=true
    strategy.exit("Second","A",profit=10,qty_percent=25)
plot(strategy.position_size,"Position")`,bars:staggerBars.slice(0,2),expected:{closed:[["A",100,105,2,10,1,1],["A",100,110,2,20,1,1]],open:[["A",100,4]],position:[0,4],profit:30,pending:[]}});
cases70.push({name:"smallest accepted quantity grid preserves partial remainder and FIFO ledger",context:{...context70,mincontract:1e-10,quantityStep:1e-10},source:`//@version=6
strategy("Tiny remainder",initial_capital=1000,calc_on_order_fills=true)
varip bool placed=false
varip bool closed=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=0.0000000003)
if strategy.position_size>0 and not placed
    placed:=true
    strategy.exit("Partial","A",profit=5,qty=0.0000000001)
if strategy.closedtrades==1 and not closed
    closed:=true
    strategy.close("A")
plot(strategy.position_size,"Position")`,bars:staggerBars.slice(0,2),expected:{closed:[["A",100,105,1e-10,5e-10,1,1],["A",100,110,2e-10,2e-9,1,1]],open:[],position:[0,0],profit:2.5e-9,pending:[]}});
export function ledger70(result){
 const n=v=>typeof v==="number"?Number(v.toPrecision(12)):v;
 return {closed:result.strategy.closedTrades.map(t=>[t.entry_id,t.entry_price,t.exit_price,t.size,t.profit,t.entry_bar_index,t.exit_bar_index].map(n)),open:result.strategy.openTrades.map(t=>[t.entry_id,t.entry_price,t.size].map(n)).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]),position:result.plots.find(p=>p.name==="Position").points.map(p=>n(p.value)),profit:n(result.strategy.metrics.netprofit),pending:result.strategy.pendingOrders.map(o=>o.id)};
}

cases70.push({name:"short partial exits retain per-entry quantities",source:program68({short:true,sizing:"qty_percent=50"}),bars:bars68.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close})),expected:{closed:[["A",100,95,-1,5,1,2],["B",90,85,-1,5,1,3],["C",90,85,-1,5,2,3]],open:[["A",100,-1],["B",90,-1],["C",90,-1]],position:[0,-4,-5,-3],profit:15,pending:[]}});
cases70.push({...cases70[4],name:"cancel all retires partial generations",source:program68({sizing:"qty=1",after:'    strategy.cancel_all()\n'})});
cases70.push({name:"fully consumed partial template resumes for a later entry without eating the old remainder",source:`//@version=6
strategy("Dormant partial",initial_capital=10000,pyramiding=4,calc_on_order_fills=true)
varip bool armed=false
varip bool later=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
if strategy.position_size==2 and not armed
    armed:=true
    strategy.exit("X",profit=5,qty=1)
if bar_index==2 and not later
    later:=true
    strategy.entry("B",strategy.long,qty=2)
plot(strategy.position_size,"Position")`,bars:[{open:100,high:101,low:99,close:100},{open:100,high:110,low:98,close:108},{open:108,high:110,low:106,close:108},{open:108,high:116,low:107,close:114},{open:114,high:120,low:113,close:118}].map((b,i)=>({...b,time:1700000040+i*60,volume:10})),expected:{closed:[["A",100,105,1,5,1,1],["B",108,113,1,5,3,3]],open:[["A",100,1],["B",108,1]],position:[0,1,1,2,2],profit:10,pending:[]}});
