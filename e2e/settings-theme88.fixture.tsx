import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsCenter } from "../frontend/src/components/settings/SettingsCenter";
import { useJournalSettings } from "../frontend/src/components/settings/useJournalSettings";
import { useSettingsPreferences } from "../frontend/src/components/settings/useSettingsPreferences";
import { useChartSettings } from "../frontend/src/components/settings/useChartSettings";
import { useBacktestSettings } from "../frontend/src/components/settings/useBacktestSettings";
import { ChartSettingsPanel } from "../frontend/src/components/settings/ChartSettingsPanel";
import { BacktestSettingsPanel } from "../frontend/src/components/settings/BacktestSettingsPanel";
import { CompatibilityJournalSettings } from "../frontend/src/components/compatibility/CompatibilityJournalSettings";
import { GlobalSettingsPanel, PrivacySettingsPanel } from "../frontend/src/components/settings/SessionPrivacyPanels";
import { SettingRow, SettingsToggle } from "../frontend/src/components/settings/SettingsPrimitives";
import { setStoredAuthSession } from "../frontend/src/lib/authSession";
const session = owner => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token: "settings-theme88-owner-" + owner,
  user: { id: owner, email: "settings88-" + owner + "@example.test", name: "Settings tester", approved: true, betaPosition: 1,
    deploymentMode: "beta", workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", isBetaUser: true, plan: "beta", provider: "email" } });
const catalog = { root: "/fixtures/market", instruments: Array.from({length:24}, (_,i)=>({
  id:"asset-"+i, name:i===23?"Very long international instrument display name with extended market description and repeated words to test constrained dropdown geometry":"Instrument "+String(i).padStart(2,"0"),
  symbol:"SYM"+i,currency:i===23?"EUR":"USD",timezone:"UTC",pnl_multiplier:1,timeframes:[] })) };
const fixture = (window as any).settingsThemeFixture = { current: null, switchOwner: owner => setStoredAuthSession(session(owner)) };
setStoredAuthSession(session(8801));
window.confirm = () => true;
function App() {
  const journal = useJournalSettings(), preferences = useSettingsPreferences(), chart = useChartSettings(), backtest = useBacktestSettings();
  const [mode,setMode]=useState("modern"), [datasets,setDatasets]=useState(catalog), [checked,setChecked]=useState(true);
  fixture.current = {journal,preferences,chart,backtest}; fixture.mode=setMode; fixture.datasets=available=>setDatasets(available?catalog:null);
  if(mode==="compatibility") return <main className="p-5 bg-stone-950 text-stone-100"><CompatibilityJournalSettings/>
    <ChartSettingsPanel compatibility settings={chart} preferences={preferences}/>
    <ChartSettingsPanel compatibility appearance settings={chart} preferences={preferences}/>
    <BacktestSettingsPanel compatibility settings={backtest}/></main>;
  if(mode==="semantic") return <main className="p-5 bg-[var(--ui-canvas)] text-[var(--text-primary)]">
    <SettingRow controlId="semantic-receipt" label="Confirmed preference" description="Real settings primitive token probe" saveState="saved"
      learnMore={{href:"#details",label:"Settings documentation"}}><SettingsToggle label="Semantic switch" checked={checked} onChange={setChecked}/></SettingRow>
    <GlobalSettingsPanel/><PrivacySettingsPanel settings={preferences}/></main>;
  return <SettingsCenter initialCategory="journal" datasets={datasets as any}
    journalDefaults={{default_broker:"Seed broker",default_currency:"USD",default_entry_type:"TAKEN",require_account_for_taken_trades:true}}
    onGetDatasetRefreshStatus={async()=>({running:false} as any)} onRefreshDatasets={async()=>({status:{running:false}} as any)}
    onUpdateDatasetAsset={async()=>{}} onUpdateDatasetSettings={async()=>{}} onUpdateJournalDefaults={()=>{}}/>;
}
createRoot(document.querySelector("#root")).render(<App/>);
