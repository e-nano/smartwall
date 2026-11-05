import { useEffect, useState } from "react";
import { Flex, Switch, Typography } from "antd";
import { api, jsonRequest } from "../api";

type Settings = { controlEnabled: boolean; catalogueEnabled: boolean };
export function RemoteAccessSettings() {
  const [settings,setSettings] = useState<Settings | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  useEffect(()=>{ void api<Settings>("/api/sync/remote-settings").then(setSettings).catch(()=>setError("Could not load remote access settings")); },[]);
  const update = async (next: Settings) => {
    setBusy(true); setError("");
    try { setSettings(await api<Settings>("/api/sync/remote-settings",jsonRequest("PATCH",next))); }
    catch { setError("Could not save remote access settings"); }
    finally { setBusy(false); }
  };
  return <Flex vertical gap={10}>
    <Typography.Text strong>Remote access</Typography.Text>
    <Typography.Text type="secondary">Linked company administrators can use permitted actions while cloud sync is enabled.</Typography.Text>
    <Flex justify="space-between" gap={12}><span>Find, Pick and Restock</span><Switch checked={settings?.controlEnabled ?? false} disabled={!settings || busy}
      aria-label="Allow remote bin guidance" onChange={enabled=>{ if(settings) void update({...settings,controlEnabled:enabled}); }} /></Flex>
    <Flex justify="space-between" gap={12}><span>Add components and images</span><Switch checked={settings?.catalogueEnabled ?? false} disabled={!settings || busy}
      aria-label="Allow remote catalogue changes" onChange={enabled=>{ if(settings) void update({...settings,catalogueEnabled:enabled}); }} /></Flex>
    {error && <Typography.Text type="danger">{error}</Typography.Text>}
  </Flex>;
}
