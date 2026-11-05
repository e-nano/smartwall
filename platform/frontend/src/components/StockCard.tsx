import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, Lightbulb, PackageX } from "lucide-react";
import { Alert, Badge, Button, Card, Col, Flex, InputNumber, Row, Select, Space, Statistic, Tag, Typography } from "antd";
import type { Bin, Part } from "../types";
import type { StockAction } from "../uiTypes";
import { ComponentThumbnail } from "./ComponentThumbnail";

const { Text, Title } = Typography;

export type StockCardDetailVisibility = {
  category: boolean;
  subcategory: boolean;
  headType: boolean;
  diameter: boolean;
  length: boolean;
};

type StockCardProps = {
  bin: Bin;
  parts: Part[];
  compact: boolean;
  onAction: (bin: Bin, action: StockAction) => void;
  onAssign: (bin: Bin, partId: string, initialQuantity?: number) => void;
  onEmpty?: (bin: Bin) => void;
  onRelearn?: (bin: Bin, initialQuantity: number) => void;
  detailVisibility?: StockCardDetailVisibility;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

export function StockCard({
  bin,
  parts,
  compact,
  onAction,
  onAssign,
  onEmpty,
  onRelearn,
  detailVisibility,
  expanded = false,
  onToggleExpand
}: StockCardProps) {
  const [partId, setPartId] = useState(bin.part_id ?? "");
  const [initialQuantity, setInitialQuantity] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [relearning, setRelearning] = useState(false);

  const selectedPart = parts.find((part) => part.part_id === partId);
  const needsLearning = Boolean(selectedPart && (!(selectedPart.weight_calibrated ?? 1) || relearning));
  const measurementReady = Boolean(bin.measurement_stable && bin.net_weight_grams !== null && bin.net_weight_grams > 0);
  const canSave = Boolean(partId && bin.online && (!needsLearning || (initialQuantity !== null && initialQuantity > 0 && measurementReady)));
  const componentName = bin.part_name ?? "Unassigned";
  const assignedPart = parts.find(part => part.part_id === bin.part_id);
  const quantity = bin.estimated_quantity ?? 0;
  const visibleDetailCount = detailVisibility
    ? [
        detailVisibility.category,
        detailVisibility.subcategory,
        detailVisibility.headType &&
          Boolean(bin.part_head_type) &&
          bin.part_head_type !== "Not applicable",
        detailVisibility.diameter &&
          Boolean(bin.part_nominal_diameter) &&
          bin.part_nominal_diameter !== "Not applicable",
        detailVisibility.length &&
          Boolean(bin.part_nominal_length) &&
          bin.part_nominal_length !== "Not applicable"
      ].filter(Boolean).length
    : 0;

  const beginChange = () => {
    setPartId(bin.part_id ?? "");
    setRelearning(false);
    setEditing(true);
  };

  const beginRelearn = () => {
    setPartId(bin.part_id ?? "");
    setInitialQuantity(null);
    setRelearning(true);
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setRelearning(false);
  };

  const save = () => {
    if (relearning && onRelearn && initialQuantity) onRelearn(bin, initialQuantity);
    else onAssign(bin, partId, needsLearning && initialQuantity ? initialQuantity : undefined);
    closeEditor();
  };

  return (
    <Card className={`stock-card detail-count-${visibleDetailCount} ${bin.low_stock ? "low" : ""} ${onToggleExpand ? "expandable-stock-card" : ""} ${expanded ? "expanded-stock-card" : ""}`}
      onClick={event => {
        if (!onToggleExpand || (event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button], .ant-select, .ant-image-preview") ||
            (expanded && (event.target as HTMLElement).closest(".ant-image"))) return;
        onToggleExpand();
      }}>
      {onToggleExpand && <Button className="stock-expand-toggle" type="text" aria-expanded={expanded} aria-controls={`component-detail-${bin.bin_id}`}
        onClick={onToggleExpand}>{expanded ? "Collapse" : "Expand"}</Button>}
      <Flex vertical gap={9} className="stock-identity">
        <Text className="card-label">Component</Text>
        <Flex align="center" gap={12}>
          <ComponentThumbnail part={assignedPart} preview={!onToggleExpand} />
          <Title level={3}>{componentName}</Title>
        </Flex>
        <Flex justify="space-between" align="flex-end" gap={12} className="stock-card-summary">
          <Space size={6} wrap>
            <Badge status={bin.online ? "success" : "default"} text={bin.online ? "Ready" : "Offline"} />
            {Boolean(bin.low_stock) && <Tag color="orange">Low stock</Tag>}
          </Space>
          <Statistic
            className="quantity-stat"
            title="Quantity"
            value={bin.estimated_quantity === null ? "-" : quantity}
            suffix={bin.estimated_quantity === null ? undefined : <small>pieces</small>}
          />
        </Flex>
      </Flex>

      {expanded && <Flex id={`component-detail-${bin.bin_id}`} className="expanded-component-detail" align="center" gap={24} wrap="wrap">
        <ComponentThumbnail part={assignedPart} size={280} />
        <Flex vertical gap={10}>
          <Text strong>{componentName}</Text>
          <Text type="secondary">Bin {bin.bin_id}</Text>
          {assignedPart?.description && <Text>{assignedPart.description}</Text>}
          {assignedPart?.source_supplier && <Text>Supplier: {assignedPart.source_supplier}</Text>}
          {assignedPart?.source_product_code && <Text>Supplier reference: {assignedPart.source_product_code}</Text>}
          <Text type="secondary">{assignedPart?.images_json && assignedPart.images_json !== "[]" ? "Click the image for a full-size preview." : "No image attached to this component yet."}</Text>
        </Flex>
      </Flex>}

      {compact && detailVisibility && (
        <Flex vertical className="stock-card-details">
          {detailVisibility.category && (
            <Flex justify="space-between" gap={10} className="stock-card-detail">
              <Text type="secondary">Category</Text>
              <Text strong>{bin.part_category ?? "Unassigned"}</Text>
            </Flex>
          )}
          {detailVisibility.subcategory && (
            <Flex justify="space-between" gap={10} className="stock-card-detail">
              <Text type="secondary">Type</Text>
              <Text strong>{bin.part_subcategory ?? "Unassigned"}</Text>
            </Flex>
          )}
          {detailVisibility.headType &&
            bin.part_head_type &&
            bin.part_head_type !== "Not applicable" && (
              <Flex justify="space-between" gap={10} className="stock-card-detail">
                <Text type="secondary">Head</Text>
                <Text strong>{bin.part_head_type}</Text>
              </Flex>
            )}
          {detailVisibility.diameter &&
            bin.part_nominal_diameter &&
            bin.part_nominal_diameter !== "Not applicable" && (
              <Flex justify="space-between" gap={10} className="stock-card-detail">
                <Text type="secondary">Diameter</Text>
                <Text strong>
                  {bin.part_measurement_system && bin.part_measurement_system !== "Not applicable"
                    ? bin.part_measurement_system + " - "
                    : ""}
                  {bin.part_nominal_diameter}
                </Text>
              </Flex>
            )}
          {detailVisibility.length &&
            bin.part_nominal_length &&
            bin.part_nominal_length !== "Not applicable" && (
              <Flex justify="space-between" gap={10} className="stock-card-detail">
                <Text type="secondary">Length</Text>
                <Text strong>{bin.part_nominal_length}</Text>
              </Flex>
            )}
        </Flex>
      )}

      {!compact && (
        <div className="stock-management">
          {bin.part_name && !editing ? (
            <Space wrap>
              <Button size="large" onClick={beginChange}>Change component</Button>
              {onRelearn && <Button size="large" onClick={beginRelearn}>Recalibrate count</Button>}
            </Space>
          ) : (
            <Flex vertical gap={10}>
              <Flex gap={8} wrap="wrap">
                <Select
                  className="component-select"
                  size="large"
                  value={partId || undefined}
                  disabled={relearning}
                  placeholder="Choose component"
                  options={parts.map((part) => ({
                    value: part.part_id,
                    label: `${part.name}${(part.weight_calibrated ?? 1) ? "" : " - first fill"}`
                  }))}
                  onChange={setPartId}
                />
                {needsLearning && (
                  <InputNumber
                    className="count-input"
                    size="large"
                    min={1}
                    precision={0}
                    value={initialQuantity}
                    placeholder="Piece count"
                    onChange={setInitialQuantity}
                  />
                )}
                <Button type="primary" size="large" icon={<ChevronRight size={18} />} disabled={!canSave} onClick={save}>
                  Save
                </Button>
                {bin.part_name && <Button size="large" onClick={closeEditor}>Cancel</Button>}
              </Flex>
              {needsLearning && (
                <Alert
                  showIcon
                  type={measurementReady ? "success" : "warning"}
                  message={measurementReady ? `Enter the ${relearning ? "current" : "first"} piece count` : "Place the pieces and wait briefly"}
                />
              )}
            </Flex>
          )}
        </div>
      )}

      <Row gutter={8} className="stock-actions">
        <Col span={8}><Button block size="large" className="find" icon={<Lightbulb size={19} />} disabled={!bin.online} onClick={() => onAction(bin, "find")}></Button></Col>
        <Col span={8}><Button block size="large" className="pick" icon={<ArrowUpFromLine size={19} />} disabled={!bin.online} onClick={() => onAction(bin, "pick")}></Button></Col>
        <Col span={8}><Button block size="large" className="restock" icon={<ArrowDownToLine size={19} />} disabled={!bin.online} onClick={() => onAction(bin, "restock")}></Button></Col>
      </Row>

      {!compact && onEmpty && bin.part_id && (
        <Button block danger size="large" className="empty-stock" icon={<PackageX size={19} />} disabled={!bin.online} onClick={() => onEmpty(bin)}>
          Empty
        </Button>
      )}
    </Card>
  );
}
