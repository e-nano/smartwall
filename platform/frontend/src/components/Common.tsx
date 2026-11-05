import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, Empty, Flex, List, Statistic, Tag, Typography } from "antd";
import type { InventoryEvent } from "../types";

const { Text } = Typography;

export function formatAge(value: string | null) {
  if (!value) return "Never seen";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Flex vertical gap={2}>
          <Text strong>{title}</Text>
          <Text type="secondary">{body}</Text>
        </Flex>
      }
    />
  );
}

export function MetricCard({ label, value, detail, tone = "neutral", icon }: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "good" | "warn";
  icon: ReactNode;
}) {
  return (
    <Card className={`metric-card ${tone}`}>
      <Flex align="center" gap={12}>
        <div className="metric-icon">{icon}</div>
        <Statistic title={label} value={value} />
      </Flex>
      <Text type="secondary" className="metric-detail">{detail}</Text>
    </Card>
  );
}

export function ActivityList({ events }: { events: InventoryEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="No stock changes yet" body="Stable quantity changes will appear here." />;
  }

  return (
    <List
      className="activity-list"
      dataSource={events}
      renderItem={(event) => {
        const inbound = event.quantity_delta > 0;
        return (
          <List.Item extra={<Tag color={inbound ? "green" : "blue"}>{inbound ? "+" : "-"}{Math.abs(event.quantity_delta)}</Tag>}>
            <List.Item.Meta
              avatar={
                <div className={`activity-icon ${inbound ? "in" : "out"}`}>
                  {inbound ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
                </div>
              }
              title={event.part_name ?? event.part_id ?? "Unassigned component"}
              description={formatAge(event.created_at)}
            />
          </List.Item>
        );
      }}
    />
  );
}
