import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, PackageCheck } from "lucide-react";
import { Card, Col, Collapse, Flex, Progress, Row, Segmented, Space, Spin, Tag, Typography } from "antd";
import { api } from "../api";
import type { Dashboard, InventoryEvent } from "../types";
import type { Movement } from "../uiTypes";
import { ActivityList, EmptyState, MetricCard } from "../components/Common";
import { QuantityTimeline } from "../components/QuantityTimeline";

const { Text } = Typography;
type TimeRange = "24h" | "7d" | "30d";

const RANGE_OPTIONS = [
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "1 month", value: "30d" }
];

const RANGE_LABELS: Record<TimeRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last month"
};

const RANGE_MS: Record<TimeRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

function eventsInsideRange(events: InventoryEvent[], range: TimeRange) {
  const cutoff = Date.now() - RANGE_MS[range];
  return events.filter((event) => new Date(event.created_at).getTime() >= cutoff);
}

type AnalysisViewProps = {
  data: Dashboard;
};

export function AnalysisView({ data }: AnalysisViewProps) {
  const [range, setRange] = useState<TimeRange>("24h");
  const [events, setEvents] = useState<InventoryEvent[]>(() => eventsInsideRange(data.events, "24h"));
  const [historyLoading, setHistoryLoading] = useState(false);
  const latestEventId = data.events[0]?.event_id;

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void api<InventoryEvent[]>(`/api/events?range=${range}`)
      .then((history) => {
        if (active) setEvents(history);
      })
      .catch(() => {
        if (active) setEvents(eventsInsideRange(data.events, range));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, latestEventId]);

  const movement = useMemo(() => {
    const movementMap = new Map<string, Movement>();
    events.forEach((event) => {
      const key = event.part_id ?? event.part_name ?? "unassigned";
      const current = movementMap.get(key) ?? {
        key,
        name: event.part_name ?? event.part_id ?? "Unassigned component",
        restocked: 0,
        picked: 0
      };
      current.restocked += Math.max(0, event.quantity_delta);
      current.picked += Math.abs(Math.min(0, event.quantity_delta));
      movementMap.set(key, current);
    });
    return [...movementMap.values()].sort(
      (left, right) => right.restocked + right.picked - (left.restocked + left.picked)
    );
  }, [events]);

  const maxMovement = Math.max(1, ...movement.map((item) => item.restocked + item.picked));
  const totalItems = data.parts.reduce((total, part) => total + part.total_quantity, 0);
  const restockedItems = events.reduce((total, event) => total + Math.max(0, event.quantity_delta), 0);
  const pickedItems = events.reduce((total, event) => total + Math.abs(Math.min(0, event.quantity_delta)), 0);
  const componentPanels = movement.map((item) => {
    const componentEvents = events.filter(
      (event) => (event.part_id ?? event.part_name ?? "unassigned") === item.key
    );
    const part = data.parts.find((candidate) => candidate.part_id === item.key);
    const currentQuantity = part?.total_quantity ?? componentEvents[0]?.new_quantity ?? 0;

    return {
      key: item.key,
      label: (
        <div className="analysis-component-summary">
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Flex vertical gap={2} className="analysis-component-name">
              <Text strong>{item.name}</Text>
              <Text type="secondary">{componentEvents.length} recorded change{componentEvents.length === 1 ? "" : "s"} · tap for timeline</Text>
            </Flex>
            <Space size={8} wrap>
              <Tag color="green">+{item.restocked}</Tag>
              <Tag color="blue">-{item.picked}</Tag>
              <Tag>{currentQuantity} now</Tag>
            </Space>
          </Flex>
          <div className="analysis-movement-bars">
            <Progress percent={(item.restocked / maxMovement) * 100} showInfo={false} strokeColor="#14b8a6" size="small" />
            <Progress percent={(item.picked / maxMovement) * 100} showInfo={false} strokeColor="#3b82f6" size="small" />
          </div>
        </div>
      ),
      children: <QuantityTimeline events={componentEvents} currentQuantity={currentQuantity} />
    };
  });

  return (
    <section className="page-content" aria-label="Stock analysis">
      <Card className="analysis-range-card">
        <Flex justify="space-between" align="center" gap={16} wrap="wrap">
          <Flex vertical gap={2}>
            <Text strong>History range</Text>
            <Text type="secondary">Metrics, component activity, and timelines update together.</Text>
          </Flex>
          <Segmented
            size="large"
            value={range}
            options={RANGE_OPTIONS}
            onChange={(value) => setRange(value as TimeRange)}
            aria-label="Analytics time range"
          />
        </Flex>
      </Card>

      <Spin spinning={historyLoading}>
        <Row gutter={[12, 12]} className="page-row metrics-row">
          <Col xs={12} lg={6}>
            <MetricCard label="Pieces in stock" value={totalItems} detail="Current wall quantity" tone="good" icon={<PackageCheck size={21} />} />
          </Col>
          <Col xs={12} lg={6}>
            <MetricCard label="Restocked" value={restockedItems} detail={RANGE_LABELS[range]} tone="good" icon={<ArrowDownToLine size={21} />} />
          </Col>
          <Col xs={12} lg={6}>
            <MetricCard label="Picked" value={pickedItems} detail={RANGE_LABELS[range]} icon={<ArrowUpFromLine size={21} />} />
          </Col>
          <Col xs={12} lg={6}>
            <MetricCard
              label="Low stock"
              value={data.summary.low_stock_bins}
              detail="Current wall status"
              tone={data.summary.low_stock_bins ? "warn" : "neutral"}
              icon={<CircleAlert size={21} />}
            />
          </Col>
        </Row>

        <Row gutter={[12, 12]} className="page-row">
          <Col xs={24} xxl={16}>
            <Card
              title={`Activity by component · ${RANGE_LABELS[range]}`}
              extra={<Space size={10}><Tag color="green">Added</Tag><Tag color="blue">Removed</Tag></Space>}
            >
              {movement.length === 0 ? (
                <EmptyState title="No changes in this period" body="Choose a longer time range or wait for the next stable stock change." />
              ) : (
                <Collapse
                  accordion
                  className="analysis-components"
                  items={componentPanels}
                  expandIconPosition="end"
                />
              )}
            </Card>
          </Col>
          <Col xs={24} xxl={8}>
            <Card title={`Recent changes · ${RANGE_LABELS[range]}`}>
              <ActivityList events={events.slice(0, 12)} />
            </Card>
          </Col>
        </Row>
      </Spin>
    </section>
  );
}
