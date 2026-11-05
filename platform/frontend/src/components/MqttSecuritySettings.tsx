import { useEffect, useState } from "react";
import { Alert, Card, Flex, Switch, Typography } from "antd";
import { RadioTower } from "lucide-react";
import { api, jsonRequest } from "../api";

type SecurityState = {
  credentialsRequired: boolean;
  discoveryEnabled: boolean;
  brokerRestarted?: boolean;
  brokerRestartPending?: boolean;
};

export function MqttSecuritySettings() {
  const [settings, setSettings] = useState<SecurityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void api<SecurityState>("/api/mqtt/security")
      .then(setSettings)
      .catch(() => setError("Could not load bin connection settings"));
  }, []);

  async function update(credentialsRequired: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await api<SecurityState>(
        "/api/mqtt/security",
        jsonRequest("PATCH", { credentialsRequired })
      );
      setSettings(next);
      setNotice(next.brokerRestarted
        ? "MQTT restarted with the new setting. Bins will reconnect automatically."
        : "Setting saved. The managed broker applies it within a few seconds; legacy installations require a broker restart.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update bin connection settings");
    } finally {
      setBusy(false);
    }
  }

  return <Card title="Automatic bin connection" extra={<RadioTower size={20} />}>
    <Flex vertical gap={14}>
      <Typography.Paragraph style={{ margin: 0 }}>
        New bins discover this wall over the local network. By default, only the Wi-Fi name and password are required on the bin.
      </Typography.Paragraph>
      <Flex justify="space-between" align="center" gap={18}>
        <div>
          <Typography.Text strong>Require MQTT credentials</Typography.Text>
          <div><Typography.Text type="secondary">When enabled, enter the station credentials under Advanced settings on each bin.</Typography.Text></div>
        </div>
        <Switch
          checked={settings?.credentialsRequired ?? false}
          disabled={!settings || busy}
          loading={busy}
          onChange={(checked) => void update(checked)}
          aria-label="Require MQTT credentials from bins"
        />
      </Flex>
      {notice && <Alert type="success" showIcon message={notice} />}
      {error && <Alert type="error" showIcon message={error} />}
    </Flex>
  </Card>;
}
