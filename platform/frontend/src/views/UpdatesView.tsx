import { SoftwareUpdates } from "../components/SoftwareUpdates";
import type { Dispatch, SetStateAction } from "react";
import { FileUp, Settings2, UploadCloud } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  List,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
  Upload
} from "antd";
import type { UploadFile } from "antd";
import type { Dashboard, Firmware } from "../types";
import type { FirmwareFormValues } from "../uiTypes";
import { EmptyState, formatBytes } from "../components/Common";
import { MqttSecuritySettings } from "../components/MqttSecuritySettings";

const { Dragger } = Upload;
const { Paragraph, Text } = Typography;

const normalizeUpload = (event: { fileList?: UploadFile[] }) => event?.fileList ?? [];

type UpdatesViewProps = {
  data: Dashboard;
  selectedBins: Set<string>;
  setSelectedBins: Dispatch<SetStateAction<Set<string>>>;
  onUpload: (values: FirmwareFormValues) => Promise<boolean>;
  onDeploy: (firmware: Firmware, all: boolean) => Promise<void>;
};

export function UpdatesView({ data, selectedBins, setSelectedBins, onUpload, onDeploy }: UpdatesViewProps) {
  const [form] = Form.useForm<FirmwareFormValues>();

  const finish = async (values: FirmwareFormValues) => {
    if (await onUpload(values)) form.resetFields();
  };

  const toggleBin = (binId: string, checked: boolean) => {
    setSelectedBins((current) => {
      const next = new Set(current);
      if (checked) next.add(binId);
      else next.delete(binId);
      return next;
    });
  };

  return (
    <section className="page-content" aria-label="Device updates">
      <Row gutter={[12, 12]} className="page-row">
        <Col xs={24} xxl={16}>
          <SoftwareUpdates />
          <MqttSecuritySettings />
          <div style={{ height: 12 }} />
          <Card title="Firmware releases" extra={<Settings2 size={20} />}>
            <Form form={form} layout="vertical" onFinish={(values) => void finish(values)} requiredMark={false}>
              <Form.Item label="Signed release manifest" name="manifest" valuePropName="fileList" getValueFromEvent={normalizeUpload} rules={[{ required: true, message: "Choose the release .json file" }]}>
                <Upload beforeUpload={() => false} maxCount={1} accept=".json"><Button>Choose firmware manifest</Button></Upload>
              </Form.Item>

              <Form.Item name="firmware" valuePropName="fileList" getValueFromEvent={normalizeUpload} rules={[{ required: true, message: "Choose firmware.bin" }]}>
                <Dragger beforeUpload={() => false} maxCount={1} accept=".bin,application/octet-stream">
                  <FileUp size={26} />
                  <Paragraph className="upload-title">Choose PlatformIO firmware.bin</Paragraph>
                  <Text type="secondary">The publisher signature and hardware compatibility are checked before rollout.</Text>
                </Dragger>
              </Form.Item>

              <Button block type="primary" size="large" htmlType="submit" icon={<UploadCloud size={18} />}>Upload release</Button>
            </Form>

            <Divider />

            {data.firmware.length === 0 ? (
              <EmptyState title="No releases uploaded" body="Upload a PlatformIO firmware.bin to prepare an OTA rollout." />
            ) : (
              <List
                dataSource={data.firmware}
                renderItem={(firmware, index) => (
                  <List.Item
                    className={index === 0 ? "latest-release" : ""}
                    actions={[
                      <Button key="selected" disabled={selectedBins.size === 0 || !firmware.hardware_target} onClick={() => void onDeploy(firmware, false)}>Update selected</Button>,
                      <Button key="all" disabled={!firmware.hardware_target} onClick={() => void onDeploy(firmware, true)}>Update compatible bins</Button>
                    ]}
                  >
                    <List.Item.Meta
                      title={`Version ${firmware.version} · ${firmware.hardware_target ?? "Legacy: deployment blocked"}`}
                      description={
                        <Flex vertical>
                          <Text type="secondary" ellipsis>
                            {formatBytes(firmware.size_bytes)} - {new Date(firmware.created_at).toLocaleDateString()} - {firmware.source === "automatic-build" ? "automatic build" : "manual upload"}
                          </Text>
                          <Text code ellipsis>{firmware.sha256.slice(0, 16)}...</Text>
                        </Flex>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xxl={8}>
          <Card title="Rollout target" extra={<Tag color="blue">{selectedBins.size} selected</Tag>} className="sticky-card rollout-card">
            <List
              dataSource={data.bins}
              renderItem={(bin) => (
                <List.Item>
                  <Checkbox disabled={!bin.online} checked={selectedBins.has(bin.bin_id)} onChange={(event) => toggleBin(bin.bin_id, event.target.checked)}>
                    <Space>
                      <Badge status={bin.online ? "success" : "default"} />
                      <Flex vertical>
                        <Text strong>{bin.bin_id}</Text>
                        <Text type="secondary">{bin.part_name ?? "Unassigned"} - {bin.firmware_version ? `v${bin.firmware_version}` : "unknown"}</Text>
                      </Flex>
                    </Space>
                  </Checkbox>
                </List.Item>
              )}
            />

            {data.automaticDeployments.length > 0 && (
              <>
                <Divider titlePlacement="start">Automatic rollout</Divider>
                <List
                  dataSource={data.automaticDeployments.slice(0, 6)}
                  renderItem={(item) => {
                    const progress = item.state === "installed" ? 100 : item.state === "downloading" ? 50 : item.state === "sent" ? 15 : 0;
                    return (
                      <List.Item>
                        <Flex vertical gap={5} className="rollout-item">
                          <Flex justify="space-between"><Text strong>{item.bin_id} - v{item.version}</Text><Text type="secondary">{item.state}</Text></Flex>
                          <Progress percent={progress} showInfo={false} size="small" status={item.state === "failed" ? "exception" : undefined} />
                          <Text type="secondary">Attempt {item.attempts}{item.message ? ` - ${item.message}` : ""}</Text>
                        </Flex>
                      </List.Item>
                    );
                  }}
                />
              </>
            )}

            {data.ota.length > 0 && (
              <>
                <Divider titlePlacement="start">Device OTA progress</Divider>
                <List
                  dataSource={data.ota.slice(0, 6)}
                  renderItem={(item) => (
                    <List.Item>
                      <Flex vertical gap={5} className="rollout-item">
                        <Flex justify="space-between"><Text strong>{item.bin_id}</Text><Text type="secondary">{item.state}</Text></Flex>
                        <Progress percent={item.progress} size="small" />
                        <Text type="secondary">{item.message ?? "Waiting for device"}</Text>
                      </Flex>
                    </List.Item>
                  )}
                />
              </>
            )}

            <Alert
              showIcon
              type="warning"
              message={data.automaticUpdates.enabled ? `Automatic updates enabled${data.automaticUpdates.version ? ` - target v${data.automaticUpdates.version}` : ""}` : "Automatic updates disabled"}
              description="Automatic updates require a verified stable release for each hardware target. Unknown hardware is never updated automatically."
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
