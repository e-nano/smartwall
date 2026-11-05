import { Col, Row } from "antd";
import { useState } from "react";
import type { Bin, Part } from "../types";
import type { StockAction } from "../uiTypes";
import { EmptyState } from "./Common";
import { StockCard } from "./StockCard";
import type { StockCardDetailVisibility } from "./StockCard";

export type StockGridProps = {
  bins: Bin[];
  parts: Part[];
  compact: boolean;
  onAction: (bin: Bin, action: StockAction) => void;
  onAssign: (bin: Bin, partId: string, initialQuantity?: number) => void;
  onEmpty?: (bin: Bin) => void;
  onRelearn?: (bin: Bin, initialQuantity: number) => void;
  emptyTitle?: string;
  emptyBody?: string;
  detailVisibility?: StockCardDetailVisibility;
  expandable?: boolean;
};

export function StockGrid({
  bins,
  parts,
  compact,
  onAction,
  onAssign,
  onEmpty,
  onRelearn,
  emptyTitle = "No stock found",
  emptyBody = "Assign a component to a connected bin and it will appear here.",
  detailVisibility,
  expandable = false
}: StockGridProps) {
  const [expandedBinId, setExpandedBinId] = useState<string | null>(null);
  if (bins.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <Row gutter={[12, 12]} className={`stock-grid ${compact ? "compact" : "manage"}`}>
      {bins.map((bin) => (
        <Col key={bin.bin_id} xs={24} sm={expandedBinId === bin.bin_id ? 24 : 12} lg={expandedBinId === bin.bin_id ? 24 : compact ? 8 : 12} xl={expandedBinId === bin.bin_id ? 24 : compact ? 6 : 12} xxl={expandedBinId === bin.bin_id ? 24 : compact ? 4 : 8}>
          <StockCard
            bin={bin}
            parts={parts}
            compact={compact}
            onAction={onAction}
            onAssign={onAssign}
            onEmpty={onEmpty}
            onRelearn={onRelearn}
            detailVisibility={detailVisibility}
            expanded={expandable && expandedBinId === bin.bin_id}
            onToggleExpand={expandable ? () => setExpandedBinId(current => current === bin.bin_id ? null : bin.bin_id) : undefined}
          />
        </Col>
      ))}
    </Row>
  );
}
