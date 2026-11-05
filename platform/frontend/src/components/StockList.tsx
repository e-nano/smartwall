import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lightbulb, Scale, Settings2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Col,
  Flex,
  InputNumber,
  List,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography
} from "antd";
import type { Bin, Part } from "../types";
import type { StockAction } from "../uiTypes";
import { COMPONENT_TAXONOMY } from "../componentTaxonomy";
import { EmptyState } from "./Common";
import { ComponentThumbnail } from "./ComponentThumbnail";

const { Text, Title } = Typography;

type ManageMode = "assign" | "relearn";

type StockListProps = {
  bins: Bin[];
  parts: Part[];
  onAction: (bin: Bin, action: StockAction) => void;
  onAssign: (bin: Bin, partId: string, initialQuantity?: number) => void;
  onEmpty: (bin: Bin) => void;
  onRelearn: (bin: Bin, initialQuantity: number) => void;
  onTare: (bin: Bin) => void;
};

export function StockList({ bins, parts, onAction, onAssign, onEmpty, onRelearn, onTare }: StockListProps) {
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [partId, setPartId] = useState("");
  const [initialQuantity, setInitialQuantity] = useState<number | null>(null);
  const [mode, setMode] = useState<ManageMode>("assign");

  const groupedPartOptions = useMemo(
    () =>
      COMPONENT_TAXONOMY.map(({ category }) => ({
        label: category,
        options: parts
          .filter((part) => part.category === category)
          .map((part) => {
            const specification = [
              part.measurement_system,
              part.nominal_diameter,
              part.nominal_length
            ].filter((value) => value && value !== "Not applicable").join(" / ");
            return {
              value: part.part_id,
              label: `${part.name} - ${part.subcategory}${specification ? ` - ${specification}` : ""}`
            };
          })
      })).filter((group) => group.options.length > 0),
    [parts]
  );

  const selectedPart = parts.find((part) => part.part_id === partId);
  const learningRequired = Boolean(selectedPart && !selectedPart.weight_calibrated);
  const measurementReady = Boolean(
    selectedBin?.measurement_stable &&
    selectedBin.net_weight_grams !== null &&
    selectedBin.net_weight_grams > 0
  );
  const quantityReady = initialQuantity !== null && initialQuantity > 0 && measurementReady;
  const canSave = Boolean(
    selectedBin?.online &&
    (mode === "relearn" ? quantityReady : partId && (!learningRequired || quantityReady))
  );

  const openManager = (bin: Bin) => {
    setSelectedBin(bin);
    setPartId(bin.part_id ?? "");
    setInitialQuantity(null);
    setMode("assign");
  };

  const closeManager = () => {
    setSelectedBin(null);
    setInitialQuantity(null);
    setMode("assign");
  };

  const save = () => {
    if (!selectedBin) return;
    if (mode === "relearn" && initialQuantity) onRelearn(selectedBin, initialQuantity);
    else onAssign(selectedBin, partId, learningRequired && initialQuantity ? initialQuantity : undefined);
    closeManager();
  };

  if (bins.length === 0) {
    return <EmptyState title="No stock matches these filters" body="Change a filter or clear the search." />;
  }

  return (
    <>
      <List
        className="stock-list"
        dataSource={bins}
        renderItem={(bin) => (
          <List.Item className="stock-list-item">
            <Row gutter={[16, 14]} align="middle" className="stock-list-row">
              <Col xs={24} lg={9}>
                <Flex align="center" gap={14}>
                  <ComponentThumbnail part={parts.find(part => part.part_id === bin.part_id)} size={52} />
                  <Flex vertical gap={5} className="stock-list-identity">
                    <Title level={4}>{bin.part_name ?? "Unassigned bin"}</Title>
                    <Space size={6} wrap>
                      <Tag color="blue">{bin.part_category ?? "Other"}</Tag>
                      <Tag>{bin.part_subcategory ?? "Other"}</Tag>
                      {bin.part_measurement_system && bin.part_measurement_system !== "Not applicable" && (
                        <Tag color="cyan">{bin.part_measurement_system}</Tag>
                      )}
                      {bin.part_nominal_diameter && bin.part_nominal_diameter !== "Not applicable" && (
                        <Tag>{bin.part_nominal_diameter}</Tag>
                      )}
                      {bin.part_nominal_length && bin.part_nominal_length !== "Not applicable" && (
                        <Tag>{bin.part_nominal_length}</Tag>
                      )}
                      {bin.part_head_type && bin.part_head_type !== "Not applicable" && (
                        <Tag color="purple">{bin.part_head_type} head</Tag>
                      )}
                      <Badge status={bin.online ? "success" : "default"} text={bin.online ? "Ready" : "Offline"} />
                      {Boolean(bin.low_stock) && <Tag color="orange">Low stock</Tag>}
                    </Space>
                  </Flex>
                </Flex>
              </Col>

              <Col xs={12} sm={6} lg={3}>
                <Statistic
                  className="stock-list-quantity"
                  title="Quantity"
                  value={bin.estimated_quantity ?? "-"}
                  suffix={bin.estimated_quantity === null ? undefined : <small>pieces</small>}
                />
              </Col>

              <Col xs={12} sm={6} lg={3}>
                <Statistic
                  className="stock-list-weight"
                  title="Weight"
                  value={bin.net_weight_grams ?? "-"}
                  precision={bin.net_weight_grams === null ? undefined : 1}
                  suffix={bin.net_weight_grams === null ? undefined : <small>g</small>}
                />
              </Col>

              <Col xs={24} sm={12} lg={9}>
                <Flex justify="flex-end" gap={8} wrap="wrap" className="stock-list-actions">
                  <Button size="large" icon={<Lightbulb size={18} />} disabled={!bin.online} onClick={() => onAction(bin, "find")}>Find</Button>
                  <Button size="large" icon={<ArrowUpFromLine size={18} />} disabled={!bin.online || !bin.part_id} onClick={() => onAction(bin, "pick")}>Pick</Button>
                  <Button size="large" icon={<ArrowDownToLine size={18} />} disabled={!bin.online || !bin.part_id} onClick={() => onAction(bin, "restock")}>Restock</Button>
                  <Button size="large" icon={<Settings2 size={18} />} onClick={() => openManager(bin)}>
                    {bin.part_id ? "Manage" : "Assign"}
                  </Button>
                </Flex>
              </Col>
            </Row>
          </List.Item>
        )}
      />

      <Modal
        title={selectedBin?.part_name ? `Manage ${selectedBin.part_name}` : "Assign component"}
        open={Boolean(selectedBin)}
        onCancel={closeManager}
        onOk={save}
        okText={mode === "relearn" ? "Save quantity calibration" : "Save assignment"}
        okButtonProps={{ disabled: !canSave }}
        destroyOnHidden
      >
        <Flex vertical gap={16}>
          {selectedBin?.part_id && (
            <Segmented
              block
              size="large"
              value={mode}
              options={[
                { label: "Change component", value: "assign" },
                { label: "Relearn quantity", value: "relearn" }
              ]}
              onChange={(value) => {
                setMode(value as ManageMode);
                setInitialQuantity(null);
              }}
            />
          )}

          <Flex vertical gap={7}>
            <Text strong>Component</Text>
            <Select
              size="large"
              value={partId || undefined}
              disabled={mode === "relearn"}
              placeholder="Choose a component"
              options={groupedPartOptions}
              onChange={(value) => {
                setPartId(value);
                setInitialQuantity(null);
              }}
            />
          </Flex>

          {(mode === "relearn" || learningRequired) && (
            <Flex vertical gap={7}>
              <Text strong>Current number of pieces</Text>
              <InputNumber
                size="large"
                min={1}
                precision={0}
                value={initialQuantity}
                placeholder="Piece count"
                onChange={setInitialQuantity}
                style={{ width: "100%" }}
              />
              <Alert
                showIcon
                type={measurementReady ? "success" : "warning"}
                message={measurementReady ? "Enter the number of pieces currently in the bin." : "Place the pieces in the bin and wait for a stable measurement."}
              />
            </Flex>
          )}

          <Button
            block
            size="large"
            icon={<Scale size={19} />}
            disabled={!selectedBin?.online}
            onClick={() => {
              if (!selectedBin) return;
              onTare(selectedBin);
              closeManager();
            }}
          >
            Tare empty bin
          </Button>

          {selectedBin?.part_id && (
            <Button
              block
              danger
              size="large"
              onClick={() => {
                onEmpty(selectedBin);
                closeManager();
              }}
            >
              Empty and clear this bin
            </Button>
          )}
        </Flex>
      </Modal>
    </>
  );
}
