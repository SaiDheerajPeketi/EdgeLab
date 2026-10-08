import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {PineInputControl} from "../frontend/src/components/PineInputControl";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {migratePineEnumInputs} from "../frontend/src/lib/pineInputMigration";
import {usePineInputMetadata} from "../frontend/src/lib/usePineInputMetadata";
import {sanitizePinePrepared} from "../frontend/src/lib/customIndicators";
import type {PineInputValue,PinePrepareResult} from "../frontend/src/lib/pineProtocol";
const fixture=(window as any).pineInputEnumFixture={current:null};
function Controls({source,prepared,inputs,onChange,onMetadata,generation}){
 const metadata=usePineInputMetadata(source,prepared);
 useEffect(()=>{if(metadata&&metadata!==prepared)onMetadata(metadata);},[metadata,prepared]);
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
  const legacy=structuredClone(prepared),legacyInputs={...inputs};for(const definition of legacy.inputDefinitions)if(definition.type==="enum"){
   const members=definition.enumMembers??[];
   definition.defval=members.find(member=>member.id===definition.defval)?.label??definition.defval;
   if(typeof legacyInputs[definition.id]==="string")legacyInputs[definition.id]=members.find(member=>member.id===legacyInputs[definition.id])?.label??legacyInputs[definition.id];
   for(const key of ["options","enumVersion","enumType","enumMembers"])delete definition[key];
  }
  const validated=sanitizePinePrepared(legacy,source);if(!validated)throw new Error("Legacy snapshot did not pass the genuine saved-metadata validator.");
  setPrepared(validated);setInputs(legacyInputs);
 };
 fixture.run=async(bars:any[])=>{
  try{const output=await createPineRuntimeJob({action:"run",source,inputs,bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}).promise;
   const {inputs:usedInputs,plots,strategy,audit,...metadata}=output;
   setPrepared(sanitizePinePrepared({...metadata,kind:"prepare"},source));setResult(output);setError("");return output;
  }catch(e){setError(String(e));throw e;}
 };
 return <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]"><h1 className="mb-5 text-xl font-semibold">Pine enum choices</h1>
  {mounted?<Controls source={source} prepared={prepared} inputs={inputs} generation={generation}
   onMetadata={metadata=>{setInputs(current=>migratePineEnumInputs(prepared,metadata,current).inputs);setPrepared(metadata);}}
   onChange={(id,value)=>setInputs(current=>({...current,[id]:value}))}/>:null}
  <p className="mt-4 text-sm text-[var(--text-secondary)]">Input edits are staged until Run.</p>
  {error?<p role="alert">{error}</p>:null}
 </main>;
}
createRoot(document.querySelector("#root")).render(<App/>);
