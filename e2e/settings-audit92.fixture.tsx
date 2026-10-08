import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {SettingsCenter} from "../frontend/src/components/settings/SettingsCenter";
import {getStoredAuthSession,setStoredAuthSession} from "../frontend/src/lib/authSession";
const session=(owner:number)=>({createdAt:"2026-01-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",token:"settings-audit92-"+owner,user:{id:owner,email:"settings92-"+owner+"@example.test",name:"Owner "+owner,approved:true,betaPosition:1,deploymentMode:"beta",workspaceAccess:true,accessExpiresAt:"2099-01-01T00:00:00Z",isBetaUser:true,plan:"beta",provider:"email"}});
const catalog=(owner:number)=>({root:owner===9201?"/owner-a/data":"/owner-b/data",instruments:[
 {id:"alpha",name:"Alpha",symbol:"ALPHA",currency:owner===9201?"USD":"JPY",timezone:"UTC",pnl_multiplier:owner===9201?1:3,timeframes:[]},
 {id:"beta",name:"Beta",symbol:"BETA",currency:"GBP",timezone:"UTC",pnl_multiplier:2,timeframes:[]}
]});
const fixture=(window as any).settingsAuditFixture={current:null,rootWrites:[],assetWrites:[],backCalls:0};
let rootGate:Promise<void>|undefined,releaseRoot:(()=>void)|undefined;
fixture.holdRoot=()=>{rootGate=new Promise(resolve=>releaseRoot=resolve)};
fixture.releaseRoot=()=>{releaseRoot?.();rootGate=undefined};
const owner=()=>getStoredAuthSession()?.user.id;
const saveRoot=async(payload)=>{fixture.rootWrites.push({owner:owner(),payload});if(rootGate)await rootGate};
const saveAsset=async(id,payload)=>{fixture.assetWrites.push({owner:owner(),id,payload})};
const refreshStatus=async()=>({running:false} as any),refresh=async()=>({status:{running:false}} as any);
setStoredAuthSession(session(9201));
function App(){
 const [datasets,setDatasets]=useState(catalog(9201));
 fixture.current={datasets,owner:owner()};
 fixture.catalog=setDatasets;
 fixture.switchOwner=(id:number)=>{setStoredAuthSession(session(id));setDatasets(catalog(id))};
 return <SettingsCenter datasets={datasets as any} initialCategory="data-providers" journalDefaults={{default_broker:"Manual",default_currency:"USD",default_entry_type:"TAKEN",require_account_for_taken_trades:true}}
  onBack={()=>fixture.backCalls++} onGetDatasetRefreshStatus={refreshStatus} onRefreshDatasets={refresh}
  onUpdateDatasetAsset={saveAsset} onUpdateDatasetSettings={saveRoot} onUpdateJournalDefaults={()=>{}}/>;
}
createRoot(document.querySelector("#root")).render(<App/>);
