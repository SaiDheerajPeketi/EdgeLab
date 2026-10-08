// Complete owned minutes; the two paths aggregate to identical chart OHLCV.
export const context115={symbol:"CHART:TEST",timeframe:"5",mintick:1,pointvalue:1};
export const start115=1_700_000_100;
const candle=(time,open,high,low,close)=>({time,open,high,low,close,volume:10});
const flat=Array.from({length:5},(_,i)=>candle(start115+i*60,100,102,98,100));
const highFirst=[[100,125,99,110],[110,111,100,100],[100,101,80,90],[90,100,89,99],[99,101,98,100]];
const lowFirst=[[100,101,80,90],[90,100,89,99],[99,125,98,110],[110,111,100,100],[100,101,99,100]];
export const minutes115=(path="low-first")=>[...flat,...(path==="low-first"?lowFirst:highFirst).map((p,i)=>candle(start115+(5+i)*60,...p))].map(bar=>({...bar}));
export function aggregate115(minutes) {
  const result=[];
  for(let i=0;i<minutes.length;i+=5) {
    const group=minutes.slice(i,i+5);
    result.push({time:group[0].time,open:group[0].open,high:Math.max(...group.map(b=>b.high)),low:Math.min(...group.map(b=>b.low)),close:group.at(-1).close,volume:group.reduce((sum,b)=>sum+b.volume,0)});
  }
  return result;
}
export const bars115=aggregate115(minutes115());
export const bracket115=({version=6,magnifier=true,fill=false}={})=>`//@version=${version}
strategy("Actual minute chronology",initial_capital=10000,default_qty_value=1,use_bar_magnifier=${magnifier},calc_on_order_fills=${fill})
varip int calls=-1
calls+=1
if bar_index==0
    strategy.entry("L",strategy.long,limit=90)
    strategy.exit("X","L",limit=115)
plot(calls,"Calls")
plot(strategy.position_size,"Position")
plot(close,"Close")
plot(close[1],"Previous")
plot(ta.sma(close,2),"SMA")`;
