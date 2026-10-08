export const bars116=Array.from({length:8},(_,i)=>({time:1700000040+i*60,open:100+i,high:103+i,low:98+i,close:101+i,volume:100}));
export function fillSource116({version=6,upper="10+2*bar_index",lower="-10+bar_index",upperOffset=2,lowerOffset=upperOffset,color="#ff0000",upperFlags="",lowerFlags="",fillFlags="",gradient="",reverse=false,inputs=false}={}) {
 const header="//@version="+version+'\nindicator("Shifted fill",overlay=false)\n';
 const settings=inputs?'shift=input.int(2,"Shift",minval=-10,maxval=10)\n':"";
 return header+settings+
  'a=plot('+upper+',"Upper",display=display.none,offset='+(inputs?"shift":upperOffset)+upperFlags+')\n'+
  'b=plot('+lower+',"Lower",display=display.none,offset='+(inputs?"shift":lowerOffset)+lowerFlags+')\n'+
  'fill('+(reverse?"b,a":"a,b")+','+(gradient||"color="+color)+',title="Cloud"'+fillFlags+')';
}
