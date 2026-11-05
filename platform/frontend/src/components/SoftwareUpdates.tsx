import { useEffect, useState } from 'react';
import { Alert, Button, Card, Flex, Typography } from 'antd';
import { api, jsonRequest } from '../api';

type ReleaseStatus = { version: string; configured: boolean; supervisor: null | {
  state: string; installedVersion?: string; error?: string; allowUpdates?: boolean;
  manifestSha256?: string; candidate?: { version: string; channel: string; releaseNotes?: string };
}};
export function SoftwareUpdates() {
  const [status,setStatus]=useState<ReleaseStatus|null>(null);
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState(''), [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const refresh=()=>api<ReleaseStatus>('/api/releases').then(value=>{if(active)setStatus(value);}).catch(()=>{});
    void refresh(); const timer=window.setInterval(()=>void refresh(),5000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[]);
  async function action(kind:'check'|'apply'|'firmware') {
    setBusy(true);setError('');setNotice('');
    try {
      await api(`/api/releases/${kind}`,jsonRequest('POST',kind==='apply'?{manifestSha256:status?.supervisor?.manifestSha256}:{}));
      setNotice(kind==='firmware'?'Verified firmware imported. Select compatible bins below to install.':'Request queued. The update supervisor will report progress here.');
    } catch(e){setError(e instanceof Error?e.message:'Update request failed');}
    finally{setBusy(false);}
  }
  const candidate=status?.supervisor?.candidate;
  return <Card title="SmartWall software updates" style={{marginBottom:12}}>
    <Flex vertical gap={12}>
      <Typography.Text>Installed version: {status?.version ?? 'Checking…'}</Typography.Text>
      {!status?.configured && <Typography.Text type="secondary">Configure an official release source during installation to check for updates.</Typography.Text>}
      {candidate && <Typography.Text>Available release: {candidate.version} ({candidate.channel})</Typography.Text>}
      {status?.supervisor?.state==='installing' && <Alert type="info" message="Updating SmartWall. Stock changes are temporarily paused." />}
      {status?.supervisor?.error && <Alert type="error" message={status.supervisor.error} />}
      <Flex gap={8} wrap>
        <Button disabled={!status?.configured || busy} onClick={()=>void action('check')}>Check for updates</Button>
        <Button type="primary" disabled={busy || !candidate || !status?.supervisor?.allowUpdates || candidate.version===status.version} onClick={()=>void action('apply')}>Install software update</Button>
        <Button disabled={busy || !status?.configured} onClick={()=>void action('firmware')}>Import released bin firmware</Button>
      </Flex>
      <Typography.Text type="secondary">Software updates briefly restart the wall. Bin firmware is installed separately.</Typography.Text>
      {notice && <Alert type="success" message={notice} />}{error && <Alert type="error" message={error} />}
    </Flex>
  </Card>;
}
