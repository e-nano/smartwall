import { RemoteAccessSettings } from "./RemoteAccessSettings";
import { ConnectWallModal } from "./ConnectWallModal";
import { useState, type ReactNode, type RefObject } from "react";
import { Activity, Archive, Box, Boxes, CircleHelp, Cloud, CloudOff, RefreshCw, RotateCw, ScanLine, Search, ShoppingCart, UploadCloud } from "lucide-react";
import { Badge, Button, Flex, Input, Layout, Menu, Popover, Switch, Tag, Typography } from "antd";
import type { InputRef, MenuProps } from "antd";
import type { Dashboard } from "../types";
import type { ViewKey } from "../uiTypes";

const { Content, Header, Sider } = Layout;
const { Title } = Typography;

const navigation = [
  { key: "goods-in" as const, label: "Goods in", icon: <ScanLine size={20} /> },
  { key: "overview" as const, label: "Live Wall", icon: <Boxes size={20} /> },
  { key: "analysis" as const, label: "Analysis", icon: <Activity size={20} /> },
  { key: "bins" as const, label: "Stock", icon: <Archive size={20} /> },
  { key: "catalog" as const, label: "Components", icon: <Box size={20} /> },
  { key: "orders" as const, label: "Orders", icon: <ShoppingCart size={20} /> },
  { key: "updates" as const, label: "Updates", icon: <UploadCloud size={20} /> },
  { key: "help" as const, label: "Help", icon: <CircleHelp size={20} /> }
];

const menuItems: MenuProps["items"] = navigation.map((item) => ({
  key: item.key,
  icon: item.icon,
  label: item.label
}));

type AppShellProps = {
  children: ReactNode;
  data: Dashboard;
  view: ViewKey;
  query: string;
  searchInput: RefObject<InputRef | null>;
  onQueryChange: (value: string) => void;
  onViewChange: (view: ViewKey) => void;
  onRefresh: () => void;
  onCloudSyncChange: (enabled: boolean) => void;
  onCloudSyncNow: () => void;
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Not yet";
}

export function AppShell({
  children,
  data,
  view,
  query,
  searchInput,
  onQueryChange,
  onViewChange,
  onRefresh,
  onCloudSyncChange,
  onCloudSyncNow
}: AppShellProps) {
  const [connectOpen,setConnectOpen]=useState(false);
  const activeTitle = navigation.find((item) => item.key === view)?.label ?? "SmartWall";
  const searchable = view === "bins" || view === "catalog";
  const sync = data.cloudSync;
  const syncLabel = !sync.available
    ? "Not configured"
    : !sync.enabled
      ? "Paused"
      : sync.lastError
        ? "Needs attention"
        : sync.running
          ? "Synchronizing"
          : sync.pending > 0
            ? `${sync.pending} queued`
            : sync.lastSuccessAt
              ? "Up to date"
              : "Ready";
  const syncColor = !sync.available || sync.lastError
    ? "error"
    : !sync.enabled
      ? "default"
      : sync.pending > 0 || sync.running
        ? "processing"
        : "success";
  const syncPanel = (
    <Flex vertical gap={14} className="cloud-sync-panel">
      <Flex justify="space-between" align="center" gap={18}>
        <div>
          <Typography.Text strong>Cloud sync</Typography.Text>
          <div><Typography.Text type="secondary">Local SQLite stays authoritative</Typography.Text></div>
        </div>
        <Switch
          checked={sync.enabled}
          disabled={!sync.available}
          onChange={onCloudSyncChange}
          aria-label="Enable cloud sync"
        />
      </Flex>
      <Flex justify="space-between" align="center">
        <Typography.Text type="secondary">Status</Typography.Text>
        <Tag color={syncColor}>{syncLabel}</Tag>
      </Flex>
      {(sync.wallName || sync.companyName) && <Typography.Text>{[sync.companyName,sync.wallName].filter(Boolean).join(" · ")}</Typography.Text>}
      <Button block type="primary" onClick={()=>setConnectOpen(true)}>{sync.configured ? "Reconnect this wall" : "Connect this wall"}</Button>
      <div className="cloud-sync-details">
        <Flex justify="space-between"><Typography.Text type="secondary">Queued changes</Typography.Text><Typography.Text strong>{sync.pending}</Typography.Text></Flex>
        <Flex justify="space-between"><Typography.Text type="secondary">Last sync</Typography.Text><Typography.Text>{dateLabel(sync.lastSuccessAt)}</Typography.Text></Flex>
        <Flex justify="space-between"><Typography.Text type="secondary">Last backup</Typography.Text><Typography.Text>{dateLabel(sync.lastBackupAt)}</Typography.Text></Flex>
      </div>
      {(sync.lastError || (sync.masterEnabled && sync.configurationError)) && (
        <Typography.Text type="danger" className="cloud-sync-error">
          {sync.lastError ?? sync.configurationError}
        </Typography.Text>
      )}
      <Button
        block
        size="large"
        icon={<RotateCw size={18} />}
        disabled={!sync.available || !sync.enabled || sync.running}
        onClick={onCloudSyncNow}
      >
        Sync now
      </Button>
      <RemoteAccessSettings />
    </Flex>
  );
  const search = (
    <Input
      ref={searchInput}
      className="search-input"
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      prefix={<Search size={19} />}
      allowClear
      size="large"
      placeholder="Search components"
      aria-label="Search components"
    />
  );

  return (
    <Layout className="smart-shell" hasSider>
      <Sider className="smart-sider" width={184} breakpoint="md" collapsedWidth={80} theme="dark" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="SmartWall"><Boxes size={23} /></div>
        <Menu
          aria-label="SmartWall sections"
          className="smart-menu"
          theme="dark"
          mode="inline"
          selectedKeys={[view]}
          items={menuItems}
          onClick={({ key }) => {
            onViewChange(key as ViewKey);
            onQueryChange("");
          }}
        />
        <a
          className="local-maker"
          href="https://e-nano.io"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="SmartWall by E-Nano"
        >
          <img src="/assets/e-nano-logo.svg" alt="E-Nano Robotics" width="422" height="107" />
          <span>by E-Nano</span>
        </a>
      </Sider>

      <Layout className="smart-main">
        <Header className="smart-header">
          <Flex wrap="wrap" justify="space-between" align="center" gap={18} className="header-layout">
            <Flex align="center" gap={12} className="header-title">
              <Title level={2}>{activeTitle}</Title>
              <Badge status={data.mqtt.connected ? "success" : "error"} text={data.mqtt.connected ? "System online" : "System offline"} />
            </Flex>
            <Flex align="center" gap={10} className="header-actions">
              {searchable && search}
              <Popover content={syncPanel} trigger="click" placement="bottomRight">
                <Badge dot color={syncColor === "success" ? "#0f766e" : syncColor === "processing" ? "#2563eb" : syncColor === "error" ? "#c2413a" : "#94a3b8"}>
                  <Button
                    size="large"
                    icon={sync.enabled ? <Cloud size={20} /> : <CloudOff size={20} />}
                    aria-label={`Cloud sync: ${syncLabel}`}
                  />
                </Badge>
              </Popover>
              <Button size="large" icon={<RefreshCw size={20} />} onClick={onRefresh} aria-label="Refresh" />
            </Flex>
          </Flex>
        </Header>
        <Content className="smart-content">{children}</Content>
        <ConnectWallModal open={connectOpen} onClose={()=>setConnectOpen(false)} onConnected={onRefresh}/>
      </Layout>
    </Layout>
  );
}
