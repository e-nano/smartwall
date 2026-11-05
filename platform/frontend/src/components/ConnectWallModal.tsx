import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex, Modal, Typography } from "antd";
import { api, jsonRequest } from "../api";

type Connection={id:string;code:string;verificationUrl:string;expiresAt:string;state:'pending'|'connected'};
export function ConnectWallModal({open,onClose,onConnected}:{open:boolean;onClose:()=>void;onConnected:()=>void}){
  const [connection,setConnection]=useState<Connection|null>(null),[error,setError]=useState(''),[starting,setStarting]=useState(false);
  const callback=useRef(onConnected);callback.current=onConnected;
  const current=useRef<Connection|null>(null);
  useEffect(()=>{current.current=connection;},[connection]);
  useEffect(()=>{
    if(!open)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    async function poll(){
      const pair=current.current;
      if(!pair || pair.state==='connected')return;
      try{
        const result=await api<Connection>('/api/sync/connect/status',jsonRequest('POST',{id:pair.id}));
        if(stopped)return;
        setError('');setConnection(result);
        if(result.state==='connected'){callback.current();return;}
        timer=setTimeout(()=>void poll(),2000);
      }catch(e){if(!stopped)setError(e instanceof Error?e.message:'Unable to check connection');}
    }
    timer=setTimeout(()=>void poll(),2000);
    return()=>{stopped=true;if(timer)clearTimeout(timer);};
  },[open,connection?.id]);
  async function start(){
    const tab=window.open('about:blank','_blank');
    if(tab)tab.opener=null;
    setStarting(true);setError('');
    try{
      const result=await api<Connection>('/api/sync/connect/start',jsonRequest('POST',{}));
      setConnection(result);current.current=result;
      if(tab)tab.location.href=result.verificationUrl;
    }catch(e){tab?.close();setError(e instanceof Error?e.message:'Unable to start connection');}
    finally{setStarting(false);}
  }
  async function close(){
    if(connection?.state==='pending'){
      try{await api('/api/sync/connect/cancel',jsonRequest('POST',{id:connection.id}));}catch(e){setError(e instanceof Error?e.message:'Unable to cancel');return;}
    }
    setConnection(null);setError('');onClose();
  }
  return <Modal title="Connect this wall to SmartWall Online" open={open} onCancel={()=>void close()} footer={<Button onClick={()=>void close()} disabled={starting}>{connection?.state==='connected'?'Done':'Cancel'}</Button>} destroyOnHidden>
    <Flex vertical gap={18}>
      <Typography.Paragraph>Sign in to the online portal as a company administrator, choose your wall and approve the connection. Sync settings are saved automatically on this station.</Typography.Paragraph>
      {error&&<Alert type="error" message={error} showIcon/>}
      {connection?.state==='connected'?<Alert type="success" message="Wall connected. Inventory synchronization is enabled." showIcon/>:connection?<>
        <Typography.Text>Check this code on the online approval screen:</Typography.Text>
        <Typography.Title level={2} style={{margin:0,letterSpacing:4}}>{connection.code.slice(0,4)}–{connection.code.slice(4)}</Typography.Title>
        <Button href={connection.verificationUrl} target="_blank" rel="noopener noreferrer" type="primary">Open online sign-in</Button>
        <Typography.Text type="secondary">Waiting for approval. Code expires at {new Date(connection.expiresAt).toLocaleTimeString()}.</Typography.Text>
        {error&&<Button onClick={()=>void start()} loading={starting}>Start again</Button>}
      </>:<Button type="primary" onClick={()=>void start()} loading={starting}>Open online sign-in</Button>}
    </Flex>
  </Modal>;
}
