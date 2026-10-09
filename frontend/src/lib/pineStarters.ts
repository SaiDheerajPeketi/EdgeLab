export type PineIndicatorStarter = {
  id: string;
  name: string;
  description: string;
  source: string;
};

function starter(id: string, name: string, description: string, body: string): PineIndicatorStarter {
  return { id, name, description, source: `//@version=6\n// Original EdgeLab starter. SPDX-License-Identifier: AGPL-3.0-only\n${body}` };
}

/** Editable originals, not copies of TradingView's built-in or community source. */
export const PINE_INDICATOR_STARTERS: readonly PineIndicatorStarter[] = [
  starter("pine-macd", "MACD", "Fast and slow EMAs, a signal line, and a momentum histogram.", `indicator("MACD", overlay=false)
price=input.source(close,"Source")
fast=input.int(12,"Fast length",minval=1,maxval=500)
slow=input.int(26,"Slow length",minval=1,maxval=500)
signalLength=input.int(9,"Signal length",minval=1,maxval=500)
macd=ta.ema(price,fast)-ta.ema(price,slow)
signal=ta.ema(macd,signalLength)
histogram=macd-signal
plot(histogram,"Histogram",color=histogram>=0?color.teal:color.red,style=plot.style_histogram)
plot(macd,"MACD",color=color.blue)
plot(signal,"Signal",color=color.orange)
hline(0,"Zero",color=color.gray)`),
  starter("pine-bollinger", "Bollinger Bands", "A moving average with standard-deviation bands.", `indicator("Bollinger Bands", overlay=true)
price=input.source(close,"Source")
length=input.int(20,"Length",minval=1,maxval=500)
multiplier=input.float(2,"Standard deviations",minval=0,maxval=10,step=0.1)
basis=ta.sma(price,length)
deviation=ta.stdev(price,length)*multiplier
plot(basis,"Basis",color=color.orange)
upperPlot=plot(basis+deviation,"Upper",color=color.blue)
lowerPlot=plot(basis-deviation,"Lower",color=color.blue)
fill(upperPlot,lowerPlot,color=color.new(color.blue,90))`),
  starter("pine-donchian", "Donchian Channel", "Rolling highs and lows, including the current candle.", `indicator("Donchian Channel", overlay=true)
length=input.int(20,"Length",minval=1,maxval=500)
upper=ta.highest(high,length)
lower=ta.lowest(low,length)
plot((upper+lower)/2,"Midpoint",color=color.orange)
upperPlot=plot(upper,"Upper",color=color.blue)
lowerPlot=plot(lower,"Lower",color=color.blue)
fill(upperPlot,lowerPlot,color=color.new(color.blue,90))`),
  starter("pine-ichimoku", "Ichimoku Cloud", "Conversion and base lines, a forward cloud, and lagging price.", `indicator("Ichimoku Cloud", overlay=true)
conversionLength=input.int(9,"Conversion length",minval=1,maxval=500)
baseLength=input.int(26,"Base length",minval=1,maxval=500)
spanLength=input.int(52,"Span B length",minval=1,maxval=500)
displacement=input.int(26,"Displacement",minval=1,maxval=250)
conversion=(ta.highest(high,conversionLength)+ta.lowest(low,conversionLength))/2
base=(ta.highest(high,baseLength)+ta.lowest(low,baseLength))/2
spanA=(conversion+base)/2
spanB=(ta.highest(high,spanLength)+ta.lowest(low,spanLength))/2
plot(conversion,"Conversion",color=color.blue)
plot(base,"Base",color=color.red)
// Displacement counts the current bar: 26 means 25 bars forward or back.
spanAPlot=plot(spanA,"Span A",color=color.teal,offset=displacement-1)
spanBPlot=plot(spanB,"Span B",color=color.red,offset=displacement-1)
plot(close,"Lagging close",color=color.green,offset=1-displacement)
fill(spanAPlot,spanBPlot,color=spanA>=spanB?color.new(color.teal,85):color.new(color.red,85))`),
  starter("pine-vwap", "UTC Daily VWAP", "Volume-weighted chart prices, reset each UTC day.", `indicator("UTC Daily VWAP", overlay=true)
price=input.source(hlc3,"Source")
// Uses loaded chart bars; a partial day cannot recover earlier missing volume.
day=math.floor(time/86400000)
var float weightedPrice=0.0
var float totalVolume=0.0
if barstate.isfirst or day!=day[1]
    weightedPrice:=0.0
    totalVolume:=0.0
weightedPrice+=price*volume
totalVolume+=volume
plot(totalVolume>0?weightedPrice/totalVolume:na,"VWAP",color=color.blue)`),
  starter("pine-heikin-ashi", "Heikin-Ashi Candles", "Average-price candles calculated from the loaded market history.", `indicator("Heikin-Ashi Candles", overlay=false)
upColor=input.color(color.teal,"Up color")
downColor=input.color(color.red,"Down color")
// Synthetic prices are for analysis; orders still fill at actual market prices.
// The first loaded HA open is seeded from the first real open and close.
ha=ticker.heikinashi(ticker.standard(syminfo.tickerid))
[o,h,l,c]=request.security(ha,timeframe.period,[open,high,low,close])
shade=c>=o?upColor:downColor
plotcandle(o,h,l,c,title="Heikin-Ashi",color=shade,wickcolor=shade,bordercolor=shade)`),
];
