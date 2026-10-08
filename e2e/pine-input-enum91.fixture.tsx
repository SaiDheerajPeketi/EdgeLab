import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {PineInputControl} from "../frontend/src/components/PineInputControl";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {usePineInputMetadata} from "../frontend/src/lib/usePineInputMetadata";
import {sanitizePinePrepared} from "../frontend/src/lib/customIndicators";
import type {PineInputValue,PinePrepareResult} from "../frontend/src/lib/pineProtocol";
const fixture=(window as any).pineInputEnumFixture={current:null};
function Controls({source,prepared,inputs,onChange,generation}){
 const metadata=usePineInputMetadata(source,prepared);
 fixture.current.definitions=metadata?.inputDefinitions??[];fixture.current.metadata=metadata;
 return <div key={generation} className="grid gap-4">{metadata?.inputDefinitions.map(definition=><PineInputControl key={definition.id} definition={definition}
  value={inputs[definition.id]} definitions={metadata.inputDefinitions} inputs={inputs} onChange={value=>onChange(definition.id,value)}/>)}</div>;
}
function App(){
 const [prepared,setPrepared]=useState<PinePrepareResult>(),[inputs,setInputs]=useState<Record<string,PineInputValue>>({}),[source,setSource]=useState(""),
  [generation,setGeneration]=useState(0),[mounted,setMounted]=useState(true),[result,setResult]=useState<any>(null),[error,setError]=useState("");
 fixture.current={definitions:prepared?.inputDefinitions??[],inputs,result,source,metadata:undefined};
 fixture.prepare=async(code:string)=>{
  const metadata=await createPineRuntimeJob({action:"prepare",source:code}).promise;
  setSource(code);setPrepared(metadata as PinePrepareResult);setInputs(Object.fromEntries(metadata.inputDefinitions.map(d=>[d.id,d.defval])));
  setResult(null);return metadata;
 };
 fixture.remount=()=>setGeneration(value=>value+1);
 fixture.savedRemount=()=>{const validated=sanitizePinePrepared(JSON.parse(JSON.stringify(fixture.current.metadata??prepared)),source);if(!validated)throw new Error("Saved metadata rejected");setPrepared(validated);setGeneration(value=>value+1);};
 fixture.metadataMounted=setMounted;
 fixture.stageInput=(id,value)=>setInputs(current=>({...current,[id]:value}));
 fixture.loadLegacy=()=>{
  const legacy=structuredClone(prepared);for(const definition of legacy.inputDefinitions)if(definition.type==="enum")delete definition.options;
  const validated=sanitizePinePrepared(legacy,source);if(!validated)throw new Error("Legacy snapshot did not pass the genuine saved-metadata validator.");
  setPrepared(validated);
 };
 fixture.run=async(bars:any[])=>{
  try{const output=await createPineRuntimeJob({action:"run",source,inputs,bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}).promise;
   const {inputs:usedInputs,plots,strategy,audit,...metadata}=output;
   setPrepared(sanitizePinePrepared({...metadata,kind:"prepare"},source));setResult(output);setError("");return output;
  }catch(e){setError(String(e));throw e;}
 };
 return <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]"><h1 className="mb-5 text-xl font-semibold">Pine enum choices</h1>
  {mounted?<Controls source={source} prepared={prepared} inputs={inputs} generation={generation}
   onChange={(id,value)=>setInputs(current=>({...current,[id]:value}))}/>:null}
  <p className="mt-4 text-sm text-[var(--text-secondary)]">Input edits are staged until Run.</p>
  {error?<p role="alert">{error}</p>:null}
 </main>;
}
createRoot(document.querySelector("#root")).render(<App/>);
