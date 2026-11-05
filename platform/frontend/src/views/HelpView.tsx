import type { ReactNode } from "react";
import { Alert, Card, Col, Flex, Row, Tag, Typography } from "antd";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Power,
  Radio,
  RefreshCw,
  Scale,
  Search,
  Settings,
  TriangleAlert,
  Wifi
} from "lucide-react";

const { Paragraph, Text, Title } = Typography;

type LedTone = "off" | "cyan" | "violet" | "amber" | "blue" | "red" | "green";
type LedPattern = "centre" | "all" | "spinner" | "alternate" | "collapse" | "expand";

type GuideItem = {
  title: string;
  signal: string;
  description: string;
  tone: LedTone;
  pattern: LedPattern;
  icon: ReactNode;
};

const deviceStates: GuideItem[] = [
  {
    title: "Ready and online",
    signal: "LEDs off",
    description: "The bin is connected and ready. Its LEDs stay off until an action or condition needs attention; the e-ink screen shows ONLINE / READY.",
    tone: "off",
    pattern: "centre",
    icon: <Radio size={21} />
  },
  {
    title: "Starting up",
    signal: "Violet spinner",
    description: "The bin is booting and checking its hardware before it connects.",
    tone: "violet",
    pattern: "spinner",
    icon: <Power size={21} />
  },
  {
    title: "Connecting to Wi-Fi",
    signal: "Breathing amber spinner",
    description: "The saved Wi-Fi network is being joined. If this continues, check that the network is available.",
    tone: "amber",
    pattern: "spinner",
    icon: <Wifi size={21} />
  },
  {
    title: "Wi-Fi setup mode",
    signal: "Blue blink every half second",
    description: "Scan the QR code on the e-ink screen to connect to the bin and enter the workshop Wi-Fi details.",
    tone: "blue",
    pattern: "all",
    icon: <Settings size={21} />
  },
  {
    title: "Wall or MQTT unavailable",
    signal: "Alternating red lights",
    description: "Wi-Fi is available, but the bin cannot reach the SmartWall service. Check the local platform and network.",
    tone: "red",
    pattern: "alternate",
    icon: <TriangleAlert size={21} />
  },
  {
    title: "Firmware update",
    signal: "Fast violet spinner",
    description: "An over-the-air update is being installed. Keep the bin powered until it restarts.",
    tone: "violet",
    pattern: "spinner",
    icon: <RefreshCw size={21} />
  },
  {
    title: "Tare or calibration",
    signal: "Alternating violet lights",
    description: "The scale is measuring. Keep the bin empty and still during a tare, or follow the calibration instructions.",
    tone: "violet",
    pattern: "alternate",
    icon: <Scale size={21} />
  },
  {
    title: "Completed",
    signal: "Green pulse",
    description: "The bin connected successfully or finished a guided stock action. The confirmation lasts briefly.",
    tone: "green",
    pattern: "all",
    icon: <CheckCircle2 size={21} />
  }
];

const stockActions: GuideItem[] = [
  {
    title: "Find",
    signal: "Rotating amber light",
    description: "The wall is identifying the requested bin. The pattern continues until the request ends or times out.",
    tone: "amber",
    pattern: "spinner",
    icon: <Search size={21} />
  },
  {
    title: "Pick",
    signal: "Blue lights move inward",
    description: "Remove stock from this bin. The same blue pattern briefly appears when a decrease in weight is detected.",
    tone: "blue",
    pattern: "collapse",
    icon: <ArrowUpFromLine size={21} />
  },
  {
    title: "Restock",
    signal: "Green lights move outward",
    description: "Add stock to this bin. The same green pattern briefly appears when an increase in weight is detected.",
    tone: "green",
    pattern: "expand",
    icon: <ArrowDownToLine size={21} />
  }
];

function LedDiagram({ tone, pattern }: Pick<GuideItem, "tone" | "pattern">) {
  return (
    <div className={`led-diagram led-${tone} led-pattern-${pattern}`} aria-hidden="true">
      <span className="led-dot led-top" />
      <span className="led-dot led-left" />
      <span className="led-dot led-centre" />
      <span className="led-dot led-right" />
      <span className="led-dot led-bottom" />
    </div>
  );
}

function GuideCard({ item }: { item: GuideItem }) {
  return (
    <Card className="led-guide-card">
      <Flex gap={16} align="flex-start">
        <LedDiagram tone={item.tone} pattern={item.pattern} />
        <div className="led-guide-copy">
          <Flex gap={9} align="center" wrap="wrap">
            <span className={`led-guide-icon led-guide-icon-${item.tone}`}>{item.icon}</span>
            <Title level={4}>{item.title}</Title>
          </Flex>
          <Tag className={`led-signal-tag led-signal-${item.tone}`}>{item.signal}</Tag>
          <Paragraph>{item.description}</Paragraph>
        </div>
      </Flex>
    </Card>
  );
}

function GuideGrid({ items }: { items: GuideItem[] }) {
  return (
    <Row gutter={[14, 14]}>
      {items.map((item) => (
        <Col xs={24} xl={12} key={item.title}>
          <GuideCard item={item} />
        </Col>
      ))}
    </Row>
  );
}

export function HelpView() {
  return (
    <section className="page-content help-page" aria-label="SmartWall help">
      <Card className="help-intro-card">
        <Flex vertical gap={10}>
          <Text className="card-label">Smart bin light guide</Text>
          <Title level={2}>What the LED colours mean</Title>
          <Paragraph>
            The bin lights show connection state, stock activity and guided actions at a glance. The integrated board uses
            five LEDs to show direction; the ESP32 DevKit uses the same colours as pulses or flashes on its single LED.
          </Paragraph>
          <Flex gap={8} wrap="wrap">
            <Tag color="blue">Integrated board · 5 LEDs</Tag>
            <Tag>ESP32 DevKit · 1 LED</Tag>
          </Flex>
        </Flex>
      </Card>

      <div className="help-section-heading">
        <Title level={3}>Finding and handling stock</Title>
        <Paragraph type="secondary">These patterns guide the operator to the correct bin and action.</Paragraph>
      </div>
      <GuideGrid items={stockActions} />

      <div className="help-section-heading">
        <Title level={3}>Device and connection states</Title>
        <Paragraph type="secondary">Use these colours to understand what the bin is doing or what needs attention.</Paragraph>
      </div>
      <GuideGrid items={deviceStates} />

      <Row gutter={[14, 14]} className="help-detail-row">
        <Col xs={24} lg={12}>
          <Card title="Connect a new bin" className="help-detail-card">
            <ol className="help-steps">
              <li>Power on the bin. A blue blink means it is ready for Wi-Fi setup.</li>
              <li>Scan the QR code on the e-ink display and join the bin network.</li>
              <li>Enter the workshop Wi-Fi details in the setup page.</li>
              <li>After the bin joins the same local network, SmartWall discovers it automatically.</li>
            </ol>
            <Alert
              showIcon
              type="info"
              message="Manual setup fallback"
              description={<>Join the displayed SmartWall network with password <Text code>smartstock</Text>, then open <Text code>http://192.168.4.1</Text>.</>}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="If a light stays on" className="help-detail-card">
            <div className="help-troubleshooting">
              <div><span className="help-colour-dot amber" /><Text><strong>Amber:</strong> confirm the saved Wi-Fi name and password, and check signal strength.</Text></div>
              <div><span className="help-colour-dot red" /><Text><strong>Red:</strong> make sure the SmartWall local platform and MQTT service are running on the same network.</Text></div>
              <div><span className="help-colour-dot blue" /><Text><strong>Blue setup blink:</strong> complete Wi-Fi setup from the QR code shown on the bin.</Text></div>
              <div><span className="help-colour-dot violet" /><Text><strong>Violet:</strong> wait for startup, calibration or the firmware update to finish before moving the bin.</Text></div>
            </div>
            <Paragraph className="help-priority-note" type="secondary">
              A guided Find, Pick or Restock request takes priority over background status lights, so the requested bin remains easy to identify.
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </section>
  );
}
