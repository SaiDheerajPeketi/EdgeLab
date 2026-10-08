import { Toggle, Checkbox, RadioGroup, Slider, SegmentedControl, Combobox, Banner, Button } from "../frontend/src/components/ui/Primitives";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ThemedDatePicker } from "../frontend/src/components/ThemedDatePicker";
import { ReplayDateTimePicker } from "../frontend/src/components/ReplayController";
import { SettingsDataTransfer } from "../frontend/src/components/settings/SettingsDataTransfer";
import { DataTransferProvider } from "../frontend/src/components/settings/useDataTransfer";
import { SettingsIntegrations } from "../frontend/src/components/settings/SettingsIntegrations";
import { setStoredAuthSession } from "../frontend/src/lib/authSession";
setStoredAuthSession({ createdAt:"2026-01-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",token:"theme110-auth",user:{id:11001,email:"theme110@example.test",name:"Theme tester",approved:true,betaPosition:1,deploymentMode:"beta",workspaceAccess:true,accessExpiresAt:"2099-01-01T00:00:00Z",isBetaUser:true,plan:"beta",provider:"google"} });
function Strip() {
  const [checked,setChecked]=useState(true),[choice,setChoice]=useState("a"),[amount,setAmount]=useState(5);
  return <section aria-label="Primitive controls" style={{marginTop:24,display:"grid",gap:12}}>
    <Toggle label="Audit toggle" checked={checked} onChange={setChecked}/><Checkbox label="Audit checkbox" checked={checked} onChange={setChecked}/>
    <RadioGroup label="Audit radios" value={choice} onChange={setChoice} options={[{value:"a",label:"First radio"},{value:"b",label:"Second radio"}]}/>
    <Slider label="Audit amount" value={amount} min={0} max={10} onChange={setAmount}/>
    <SegmentedControl label="Audit segment" value={choice} onChange={setChoice} options={[{value:"a",label:"First segment"},{value:"b",label:"Second segment"}]}/>
    <Combobox label="Audit combobox" value={choice} onChange={setChoice} options={[{value:"a",label:"First option"},{value:"b",label:"Second option"}]}/>
    <Banner title="Audit information" tone="info">The component follows semantic information colors.</Banner><Button tone="primary">Audit primary action</Button>
  </section>;
}
function Fixture() {
  const [view,setView]=useState("date"),[date,setDate]=useState("2026-10-08"),[time,setTime]=useState("2026-10-08T13:25"),[hours,setHours]=useState<"12-hour"|"24-hour">("12-hour");
  return <MemoryRouter><DataTransferProvider><main style={{maxWidth:960,margin:"24px auto",padding:24,color:"var(--text-primary)",background:"var(--ui-panel)"}}>
    <nav aria-label="Fixture sections" style={{display:"flex",gap:16,marginBottom:24}}>{["date","transfer","integrations"].map(name=><button key={name} onClick={()=>setView(name)} style={{minHeight:44}}>{name}</button>)}</nav>
    {view==="date"?<><ThemedDatePicker ariaLabel="Audit date" value={date} onChange={setDate}/><output data-testid="date-owner">{date}</output>
      <button type="button" onClick={()=>setHours(hours==="12-hour"?"24-hour":"12-hour")} style={{minHeight:44}}>Use {hours==="12-hour"?"24":"12"} hour time</button>
      <ReplayDateTimePicker currentTimestamp={null} dateFormat="yyyy-MM-dd" dayOfWeekLabels={false} disabled={false} dialogLabel="Audit date and time" onChange={setTime} timeHoursFormat={hours} value={time}/><output data-testid="time-owner">{time}</output><Strip/></>:view==="transfer"?<SettingsDataTransfer/>:<SettingsIntegrations/>}
  </main></DataTransferProvider></MemoryRouter>;
}
createRoot(document.querySelector("#root")!).render(<Fixture/>);
