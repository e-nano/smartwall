import { Flex, Typography } from "antd";
import type { InventoryEvent } from "../types";

const { Text } = Typography;

type TimelinePoint = {
  event: InventoryEvent | null;
  timestamp: number;
  quantity: number;
};

const axisTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function niceAxisMaximum(value: number) {
  if (value <= 4) return 4;
  const roughStep = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return Math.ceil(value / step) * step;
}

function buildTimeline(events: InventoryEvent[], currentQuantity: number) {
  const newestFirst = [...events].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
  let quantityAfter = Math.max(0, currentQuantity);
  const eventPoints = newestFirst.map((event) => {
    const point: TimelinePoint = {
      event,
      timestamp: new Date(event.created_at).getTime(),
      quantity: quantityAfter
    };
    quantityAfter = Math.max(0, quantityAfter - event.quantity_delta);
    return point;
  }).reverse();

  if (eventPoints.length === 0) return [];
  const first = eventPoints[0]!;
  const last = eventPoints[eventPoints.length - 1]!;
  const span = Math.max(60_000, last.timestamp - first.timestamp);
  return [
    {
      event: null,
      timestamp: first.timestamp - Math.max(60_000, span * 0.08),
      quantity: Math.max(0, first.quantity - first.event!.quantity_delta)
    },
    ...eventPoints
  ];
}

export function QuantityTimeline({ events, currentQuantity }: {
  events: InventoryEvent[];
  currentQuantity: number;
}) {
  const points = buildTimeline(events, currentQuantity);
  if (points.length < 2) return null;

  const width = 920;
  const height = 310;
  const padding = { top: 28, right: 24, bottom: 62, left: 68 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const firstTime = points[0]!.timestamp;
  const lastTime = points[points.length - 1]!.timestamp;
  const timeSpan = Math.max(1, lastTime - firstTime);
  const maximum = niceAxisMaximum(Math.max(...points.map((point) => point.quantity), 1));
  const x = (timestamp: number) => padding.left + ((timestamp - firstTime) / timeSpan) * plotWidth;
  const y = (quantity: number) => padding.top + plotHeight - (quantity / maximum) * plotHeight;
  const path = points.reduce((value, point, index) => {
    const pointX = x(point.timestamp);
    const pointY = y(point.quantity);
    if (index === 0) return `M ${pointX} ${pointY}`;
    return `${value} H ${pointX} V ${pointY}`;
  }, "");
  const yTicks = Array.from({ length: 5 }, (_, index) => (maximum / 4) * index);
  const firstEventTime = points[1]!.timestamp;
  const eventSpan = lastTime - firstEventTime;
  const xTickTimes = [...new Set([firstEventTime, firstEventTime + eventSpan / 2, lastTime])];
  const showPointLabels = points.length <= 6;

  return (
    <div className="quantity-timeline">
      <svg
        className="quantity-timeline-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Quantity timeline with ${events.length} recorded stock changes`}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="timeline-grid-line" x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} />
            <text className="timeline-axis-label" x={padding.left - 12} y={y(tick) + 5} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}

        <line className="timeline-axis-line" x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
        <line className="timeline-axis-line" x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
        <text className="timeline-axis-title" x={18} y={height / 2} textAnchor="middle" transform={`rotate(-90 18 ${height / 2})`}>
          Quantity
        </text>

        {xTickTimes.map((tickTime, index) => (
          <g key={`${tickTime}-${index}`}>
            <line className="timeline-tick" x1={x(tickTime)} x2={x(tickTime)} y1={height - padding.bottom} y2={height - padding.bottom + 7} />
            <text
              className="timeline-axis-label"
              x={x(tickTime)}
              y={height - padding.bottom + 27}
              textAnchor={xTickTimes.length === 1 ? "middle" : index === 0 ? "start" : index === xTickTimes.length - 1 ? "end" : "middle"}
            >
              {axisTime.format(tickTime)}
            </text>
          </g>
        ))}

        <path className="timeline-quantity-line" d={path} />
        {showPointLabels && points.slice(1).map((point) => (
          <text
            key={point.event!.event_id}
            className="timeline-point-label"
            x={x(point.timestamp)}
            y={Math.max(15, y(point.quantity) - 10)}
            textAnchor="middle"
          >
            {point.quantity}
          </text>
        ))}
      </svg>

      <Flex justify="space-between" align="center" gap={12} wrap="wrap" className="timeline-footer">
        <Text type="secondary">Each step is a stable stock change; quantity is shown on the vertical axis.</Text>
        <Text type="secondary">
          {events.length} changes · {axisTime.format(firstEventTime)} to {axisTime.format(lastTime)}
        </Text>
      </Flex>
    </div>
  );
}
