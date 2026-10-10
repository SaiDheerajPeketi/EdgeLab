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
  starter("pine-stochastic", "Stochastic", "Smoothed %K and %D measure price within its recent high-low range.", `indicator("Stochastic", overlay=false, precision=2)
length=input.int(14,"Lookback",minval=1,maxval=500)
smoothK=input.int(3,"K smoothing",minval=1,maxval=500)
smoothD=input.int(3,"D smoothing",minval=1,maxval=500)
upperLevel=input.float(80,"Upper level",minval=0,maxval=100)
lowerLevel=input.float(20,"Lower level",minval=0,maxval=100)
k=ta.sma(ta.stoch(close,high,low,length),smoothK)
d=ta.sma(k,smoothD)
plot(k,"%K",color=color.blue)
plot(d,"%D",color=color.orange)
upper=hline(upperLevel,"Upper",color=color.gray)
hline(50,"Midpoint",color=color.new(color.gray,60))
lower=hline(lowerLevel,"Lower",color=color.gray)
fill(upper,lower,color=color.new(color.blue,94))`),
  starter("pine-stochastic-rsi", "Stochastic RSI", "Smoothed %K and %D measure RSI within its recent range, on a 0–100 scale.", `indicator("Stochastic RSI", overlay=false, precision=2)
price=input.source(close,"RSI source")
rsiLength=input.int(14,"RSI length",minval=1,maxval=500)
stochLength=input.int(14,"Stochastic length",minval=1,maxval=500)
smoothK=input.int(3,"K smoothing",minval=1,maxval=500)
smoothD=input.int(3,"D smoothing",minval=1,maxval=500)
upperLevel=input.float(80,"Upper level",minval=0,maxval=100)
lowerLevel=input.float(20,"Lower level",minval=0,maxval=100)
rsi=ta.rsi(price,rsiLength)
k=ta.sma(ta.stoch(rsi,rsi,rsi,stochLength),smoothK)
d=ta.sma(k,smoothD)
plot(k,"%K",color=color.blue)
plot(d,"%D",color=color.orange)
upper=hline(upperLevel,"Upper",color=color.gray)
hline(50,"Midpoint",color=color.new(color.gray,60))
lower=hline(lowerLevel,"Lower",color=color.gray)
fill(upper,lower,color=color.new(color.blue,94))`),
  starter("pine-dmi", "Directional Movement Index", "+DI and −DI show direction; ADX measures trend strength.", `indicator("Directional Movement Index", overlay=false, precision=2)
diLength=input.int(14,"DI length",minval=1,maxval=500)
adxSmoothing=input.int(14,"ADX smoothing",minval=1,maxval=500)
[plus,minus,adx]=ta.dmi(diLength,adxSmoothing)
plot(plus,"+DI",color=color.teal)
plot(minus,"−DI",color=color.red)
plot(adx,"ADX",color=color.orange)`),
  starter("pine-sar", "Parabolic SAR", "Stop-and-reverse crosses track the direction of a price trend.", `indicator("Parabolic SAR", overlay=true)
start=input.float(0.02,"Start",minval=0,maxval=1,step=0.01)
increment=input.float(0.02,"Increment",minval=0,maxval=1,step=0.01)
maximum=input.float(0.2,"Maximum",minval=0,maxval=1,step=0.01)
plot(ta.sar(start,increment,maximum),"SAR",color=color.blue,style=plot.style_cross)`),
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
  starter("pine-cmf", "Chaikin Money Flow", "Volume-weighted closing position within each candle's range, over a rolling window.", `indicator("Chaikin Money Flow", overlay=false, precision=4)
length=input.int(20,"Length",minval=1,maxval=500)
// Flat candles contribute zero flow while their volume stays in the denominator.
multiplier=high==low?0.0:((close-low)-(high-close))/(high-low)
// Calculate both rolling sums on every bar; a zero-volume ratio stays missing.
plot(math.sum(multiplier*volume,length)/math.sum(volume,length),"CMF",color=color.teal)
hline(0,"Zero",color=color.gray)`),
  starter("pine-chaikin-oscillator", "Chaikin Oscillator", "Compares fast and slow averages of accumulation/distribution to show changes in volume pressure.", `indicator("Chaikin Oscillator", overlay=false, precision=2)
fastLength=input.int(3,"Fast length",minval=1,maxval=500)
slowLength=input.int(10,"Slow length",minval=1,maxval=500)
multiplier=high==low?0.0:((close-low)-(high-close))/(high-low)
accumulation=ta.cum(multiplier*volume)
oscillator=ta.ema(accumulation,fastLength)-ta.ema(accumulation,slowLength)
plot(oscillator,"Chaikin Oscillator",color=color.teal)
hline(0,"Zero",color=color.gray)`),
  starter("pine-elder-force", "Elder Force Index", "Smooths price change multiplied by volume to compare upward and downward pressure.", `indicator("Elder Force Index", overlay=false, precision=2)
price=input.source(close,"Source")
length=input.int(13,"Length",minval=1,maxval=500)
plot(ta.ema(ta.change(price)*volume,length),"EFI",color=color.blue)
hline(0,"Zero",color=color.gray)`),
];
