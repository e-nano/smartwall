import { App as AntApp, Alert, Button, Card, Col, Empty, Flex, List, Row, Space, Statistic, Tag, Typography } from "antd";
import { ClipboardCopy, Download, ExternalLink, PackageSearch, ShoppingCart } from "lucide-react";
import type { Part } from "../types";

const { Text } = Typography;
const ACCU_QUICK_ORDER_URL = "https://www.accu.co.uk/quick-order";

type OrdersViewProps = {
  parts: Part[];
  onOpenComponents: () => void;
};

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function OrdersView({ parts, onOpenComponents }: OrdersViewProps) {
  const { message } = AntApp.useApp();
  const lowStockParts = parts.filter((part) => part.total_quantity <= part.reorder_level);
  const readyLines = lowStockParts.filter(
    (part) => part.accu_product_code.trim() && part.accu_order_quantity > 0
  );
  const needsMapping = lowStockParts.filter(
    (part) => !part.accu_product_code.trim() || part.accu_order_quantity <= 0
  );
  const totalUnits = readyLines.reduce((sum, part) => sum + part.accu_order_quantity, 0);
  const orderText = readyLines
    .map((part) => `${part.accu_product_code}\t${part.accu_order_quantity}`)
    .join("\n");

  const copyOrder = async () => {
    try {
      await navigator.clipboard.writeText(orderText);
      message.success(`Copied ${readyLines.length} Accu order line${readyLines.length === 1 ? "" : "s"}`);
    } catch {
      message.error("Could not access the clipboard");
    }
  };

  const copyOrderLine = async (part: Part) => {
    try {
      await navigator.clipboard.writeText(`${part.accu_product_code}\t${part.accu_order_quantity}`);
      message.success(`${part.accu_product_code} and quantity copied`);
    } catch {
      message.error("Could not access the clipboard");
    }
  };

  const copyAndOpenAccu = () => {
    window.open(ACCU_QUICK_ORDER_URL, "_blank", "noopener,noreferrer");
    void navigator.clipboard.writeText(orderText).then(
      () => message.success("Order copied. Paste it into the Accu Quick Order project."),
      () => message.warning("Accu opened, but copying failed. Return here and use Copy order list.")
    );
  };

  const downloadCsv = () => {
    const rows = [
      ["Accu product code", "Quantity", "SmartWall component", "Current stock", "Reorder level"],
      ...readyLines.map((part) => [
        part.accu_product_code,
        part.accu_order_quantity,
        part.name,
        part.total_quantity,
        part.reorder_level
      ])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartwall-accu-order-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    message.success("Accu order CSV downloaded");
  };

  return (
    <section className="page-content" aria-label="Accu purchasing">
      <Row gutter={[12, 12]} className="page-row">
        <Col xs={24} md={8}>
          <Card className="metric-card warn">
            <Statistic title="Low-stock components" value={lowStockParts.length} prefix={<PackageSearch size={28} />} />
            <Text type="secondary" className="metric-detail">At or below their reorder level</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="metric-card good">
            <Statistic title="Ready for Accu" value={readyLines.length} prefix={<ShoppingCart size={28} />} />
            <Text type="secondary" className="metric-detail">Verified product codes</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="metric-card">
            <Statistic title="Units to order" value={totalUnits} />
            <Text type="secondary" className="metric-detail">Across the prepared order</Text>
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Accu order list"
            extra={<Tag color={readyLines.length ? "green" : "default"}>{readyLines.length} ready</Tag>}
          >
            <Alert
              showIcon
              type="info"
              message="Accu does not support a pre-filled Quick Order link"
              description="Use Copy & open Accu. SmartWall copies the prepared product-code and quantity rows, then opens Accu. Paste them into the project and verify the quantities before checkout."
              className="form-alert"
            />

            {readyLines.length === 0 ? (
              <Empty description="No mapped low-stock components are ready to order" />
            ) : (
              <List
                dataSource={readyLines}
                renderItem={(part) => (
                  <List.Item
                    extra={
                      <Space size={12} wrap>
                        <Statistic value={part.accu_order_quantity} suffix={<small>to order</small>} />
                        <Button
                          size="large"
                          icon={<ClipboardCopy size={19} />}
                          aria-label={`Copy order line for ${part.name}`}
                          onClick={() => void copyOrderLine(part)}
                        >
                          Copy
                        </Button>
                      </Space>
                    }
                  >
                    <List.Item.Meta
                      title={part.name}
                      description={
                        <Space size={8} wrap>
                          <Tag color="green">{part.accu_product_code}</Tag>
                          <Text type="secondary">{part.total_quantity} in stock</Text>
                          <Text type="secondary">reorder at {part.reorder_level}</Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}

            <Flex gap={10} wrap="wrap" className="order-actions">
              <Button
                size="large"
                icon={<ClipboardCopy size={19} />}
                disabled={!readyLines.length}
                onClick={() => void copyOrder()}
              >
                Copy order list
              </Button>
              <Button
                size="large"
                icon={<Download size={19} />}
                disabled={!readyLines.length}
                onClick={downloadCsv}
              >
                Download CSV
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<ExternalLink size={19} />}
                disabled={!readyLines.length}
                onClick={copyAndOpenAccu}
              >
                Copy &amp; open Accu
              </Button>
            </Flex>
          </Card>
        </Col>

        {needsMapping.length > 0 && (
          <Col xs={24}>
            <Card
              title="Needs Accu mapping"
              extra={<Button size="large" onClick={onOpenComponents}>Open Components</Button>}
            >
              <List
                dataSource={needsMapping}
                renderItem={(part) => (
                  <List.Item>
                    <List.Item.Meta
                      title={part.name}
                      description={`${part.total_quantity} in stock · reorder at ${part.reorder_level}`}
                    />
                    <Tag color="orange">
                      {part.accu_product_code ? "Set order quantity" : "Add Accu code"}
                    </Tag>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        )}
      </Row>
    </section>
  );
}
