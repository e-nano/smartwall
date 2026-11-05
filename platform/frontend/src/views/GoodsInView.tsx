import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Flex, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, App } from "antd";
import type { InputRef } from "antd";
import { ScanLine } from "lucide-react";
import { api, jsonRequest } from "../api";
import type { Bin, Part } from "../types";
const { Text, Title } = Typography;
type RecordValue = Record<string, any>;
function intakeRequestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function GoodsInView({ bins, parts, onRefresh, incomingScan, onScanHandled }: {
  bins: Bin[]; parts: Part[]; onRefresh: () => Promise<void>;
  incomingScan: { raw: string; id: number } | null; onScanHandled: (id: number) => void;
}) {
  const { message } = App.useApp();
  const input = useRef<InputRef>(null);
  const scanRaw = useRef("");
  const requestKey = useRef(intakeRequestKey());
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<RecordValue | null>(null);
  const [snapshot, setSnapshot] = useState<RecordValue>({ intakes: [], supplierItems: [], identifiers: [], catalogue: [], audit: [] });
  const [busy, setBusy] = useState(false);
  const [component, setComponent] = useState("");
  const [name, setName] = useState("");
  const [verified, setVerified] = useState(false);
  const [remap, setRemap] = useState(false);
  const [reason, setReason] = useState("");
  const [binId, setBinId] = useState("");
  const [readyBin, setReadyBin] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [catalogueJson, setCatalogueJson] = useState("");
  const [catalogueVerified, setCatalogueVerified] = useState(false);
  const mounted = useRef(true);
  const actionBusy = useRef(false);
  const handledScan = useRef<number | null>(null);
  const inputScanTimer = useRef<number | undefined>(undefined);
  const refresh = async () => { const next = await api<RecordValue>("/api/goods-in"); if (mounted.current) setSnapshot(next); };
  useEffect(() => {
    mounted.current = true; input.current?.focus();
    void refresh().catch(error => message.error(error.message));
    const interval = window.setInterval(() => void refresh().catch(() => {}), 3000);
    return () => { mounted.current = false; window.clearInterval(interval); window.clearTimeout(inputScanTimer.current); };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    try { await fn(); await refresh(); await onRefresh(); }
    catch (error) { message.error(error instanceof Error ? error.message : "Goods-in action failed"); }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false); }
  };
  const resolve = (scannedRaw: string, automatic = false) => void run(async () => {
    if (!scannedRaw.trim()) return;
    window.clearTimeout(inputScanTimer.current);
    scanRaw.current = scannedRaw; setRaw(scannedRaw); setResult(null); setReadyBin("");
    const next = await api<RecordValue>("/api/goods-in/resolve", jsonRequest("POST", { raw: scannedRaw }));
    if (!mounted.current) return;
    setResult(next); setComponent(""); setName(next.parsed?.name ?? ""); setVerified(false); setRemap(false); setReason(""); setBinId(""); requestKey.current = intakeRequestKey();
    if (automatic && next.status === "resolved") {
      // Only an existing, uniquely assigned online bin is safe to choose automatically.
      const assigned = bins.filter(bin => bin.online && bin.part_id === next.component.part_id);
      if (assigned.length === 1) {
        const selected = assigned[0]!; setBinId(selected.bin_id);
        const intake = await api<RecordValue>("/api/goods-in/intakes", jsonRequest("POST", {
          raw: scannedRaw, partId: next.component.part_id, binId: selected.bin_id, requestKey: requestKey.current
        }));
        if (intake.state === "failed") throw new Error(intake.message);
        setReadyBin(selected.bin_id);
        message.success(`Mapped product: ${next.component.name}. ${selected.bin_id} is ready for restocking.`);
      } else message.info(`Mapped product: ${next.component.name}. Select a bin to restock.`);
    }
    if (mounted.current) input.current?.select();
  });
  const scan = () => resolve(input.current?.input?.value ?? raw, true);
  useEffect(() => {
    if (!incomingScan || actionBusy.current || handledScan.current === incomingScan.id) return;
    handledScan.current = incomingScan.id; onScanHandled(incomingScan.id);
    resolve(incomingScan.raw, true);
  }, [incomingScan, busy]);
  const componentId = result?.component?.part_id;
  const available = bins.filter(bin => bin.online && (!bin.part_id || bin.part_id === componentId));
  const nextScan = () => { setResult(null); setRaw(""); input.current?.focus(); };
  return <Flex vertical gap={20}>
    <Card>
      <Title level={3}>Goods in</Title>
      <Text type="secondary">Scan a product label from any screen. A mapped product with one assigned online bin starts guided restocking automatically.</Text>
      <Flex gap={12} style={{ marginTop: 20 }}>
        <Input ref={input} data-goods-in-scan="true" prefix={<ScanLine size={20} />} aria-label="Scan product barcode or QR code" placeholder="Scan barcode / QR, or paste a product code" size="large"
          value={raw} maxLength={2048} disabled={busy} onChange={event => {
            const value = event.target.value; setRaw(value);
            if (value !== scanRaw.current) setResult(null);
            window.clearTimeout(inputScanTimer.current);
            if (value.trim()) inputScanTimer.current = window.setTimeout(() => {
              if (mounted.current && !actionBusy.current) resolve(value, true);
            }, 700);
          }} onPressEnter={event => { event.preventDefault(); scan(); }} onKeyDown={event => {
            if (event.key === "Tab" && (input.current?.input?.value ?? raw).trim()) { event.preventDefault(); scan(); }
          }} />
        <Button type="primary" size="large" loading={busy} onClick={scan}>Resolve scan</Button>
      </Flex>
      <Text type="secondary">Scanner listening while this window is active. Scan here for reliable automatic submission after a short pause, or finish with Enter / Tab. Fast scans also open Goods in from other screens; other form fields keep normal typing.</Text>
    </Card>
    {result && <Card>
      {result.status === "rejected" ? <Alert type="warning" showIcon message={result.message} /> : result.status === "resolved" ? <Flex vertical gap={16}>
        <Alert type="success" showIcon message={`${result.created ? "Created" : "Found"}: ${result.component.name}`} description={readyBin ? `${readyBin} is ready. Add stock when its light flashes green, then check the receipt below${result.component.weight_calibrated ? "." : " and confirm the piece count to learn unit weight."}` : result.component.weight_calibrated ? "Select its bin and add the contents. Stable quantity increases are recorded automatically." : "For the first fill, start with an empty, tared bin. Confirm the piece count after adding the contents so the scale can learn unit weight."} />
        <Select size="large" aria-label="Select goods-in bin" value={binId || undefined} placeholder="Select an online bin" onChange={setBinId}
          options={available.map(bin => ({ value: bin.bin_id, label: `${bin.bin_id} · ${bin.part_name ?? "Unassigned"}` }))} />
        {!available.length && <Text type="warning">No suitable online bin. Empty and clear a bin before assigning a different component.</Text>}
        <Space><Button type="primary" loading={busy} disabled={!binId || readyBin === binId} onClick={() => void run(async () => {
          const intake = await api<RecordValue>("/api/goods-in/intakes", jsonRequest("POST", { raw: scanRaw.current, partId: componentId, binId, requestKey: requestKey.current }));
          if (intake.state === "failed") { requestKey.current = intakeRequestKey(); throw new Error(intake.message); }
          message.success("Bin is ready. Add the contents when its light flashes green."); nextScan();
        })}>Start guided restock</Button><Button onClick={nextScan}>Next scan</Button><Button onClick={() => { setResult({ status: "conflict", parsed: result.parsed, message: "Explicitly correct this product mapping" }); setComponent(componentId); setVerified(false); setRemap(false); setReason(""); }}>Correct mapping</Button></Space>
      </Flex> : <Flex vertical gap={16}>
        <Alert type={result.status === "conflict" ? "error" : "info"} showIcon message={result.status === "conflict" ? result.message ?? "Conflicting code detected — please correct the mapping" : "New code detected — please map this product"}
          description="Choose an existing component or create one. This product identifier will be remembered for future scans." />
        {result.parsed?.supplier && <Text>Supplier: {result.parsed.supplier} · Product code: {result.parsed.partNumber ?? "Not identified"}</Text>}
        <Select aria-label="Match scanned product" size="large" value={component || undefined} onChange={setComponent} placeholder="Choose existing component, or create new"
          options={[...(result.status === "conflict" ? [] : [{ value: "new", label: "Create a new component" }]), ...parts.map(part => ({ value: part.part_id, label: `${part.name} · ${part.part_id}` }))]} showSearch optionFilterProp="label" />
        {component === "new" && <Input aria-label="New component name" placeholder="Component name" maxLength={100} value={name} onChange={event => setName(event.target.value)} />}
        <Checkbox checked={verified} onChange={event => setVerified(event.target.checked)}>I verified this identifies the product, rather than a shipment or tracking label.</Checkbox>
        {result.status === "conflict" && <><Checkbox checked={remap} onChange={event => setRemap(event.target.checked)}>Explicitly remap the conflicting identifiers to this component</Checkbox><Input aria-label="Reason for identifier remapping" placeholder="Reason for remapping" value={reason} maxLength={240} onChange={event => setReason(event.target.value)} /></>}
        <Button type="primary" loading={busy} disabled={!verified || !component || (component === "new" && !name.trim()) || (result.status === "conflict" && (!remap || !reason.trim()))}
          onClick={() => void run(async () => {
            setResult(await api<RecordValue>("/api/goods-in/map", jsonRequest("POST", { raw: scanRaw.current, ...(component !== "new" ? { partId: component } : { name, description: result.parsed?.description ?? "" }), productVerified: verified, remap, reason })));
          })}>Save product mapping</Button>
      </Flex>}
    </Card>}
    <Card title="Recent goods-in receipts">
      <Table rowKey="intake_id" dataSource={snapshot.intakes} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
        { title: "Component / bin", render: (_, row: RecordValue) => <><Text strong>{row.part_name}</Text><div>{row.bin_id}</div></> },
        { title: "Status", render: (_, row: RecordValue) => <Tag color={row.state === "completed" ? "green" : row.state === "failed" || row.state === "timed_out" ? "red" : "blue"}>{row.state.replaceAll("_", " ")}</Tag> },
        { title: "Added", render: (_, row: RecordValue) => row.quantity_added ?? row.estimated_added ?? "Count required" },
        { title: "Started", render: (_, row: RecordValue) => new Date(row.started_at).toLocaleString() },
        { title: "Action", render: (_, row: RecordValue) => <Space>{row.state === "awaiting_confirmation" && <Button onClick={() => { setConfirmId(row.intake_id); setCount(row.estimated_added ?? null); }}>Confirm count</Button>}
          {["awaiting_fill", "awaiting_confirmation"].includes(row.state) && <Button disabled={busy} onClick={() => void run(async () => { await api(`/api/goods-in/intakes/${row.intake_id}/cancel`, jsonRequest("POST", {})); })}>Cancel</Button>}{row.message && <Text type="danger">{row.message}</Text>}</Space> }
      ]} />
    </Card>
    <Card title="Supplier catalogue" extra={<Button onClick={() => setCatalogueOpen(true)}>Import verified products</Button>}>
      <Text type="secondary">Verified supplier products enable automatic creation. Learned mappings work offline. {snapshot.catalogue.length} verified products · {snapshot.supplierItems.length} linked supplier items · {snapshot.identifiers.length} identifiers.</Text>
    </Card>
    <Card title="Mapping and intake audit">
      <Table rowKey="id" dataSource={snapshot.audit} pagination={{ pageSize: 5 }} columns={[
        { title: "Action", render: (_, row: RecordValue) => row.action.replaceAll("_", " ") },
        { title: "Details", render: (_, row: RecordValue) => row.reason || row.raw_value || row.part_id || row.intake_id || `${row.count ?? ""} records` },
        { title: "Time", render: (_, row: RecordValue) => new Date(row.created_at).toLocaleString() }
      ]} />
    </Card>
    <Modal title="Confirm pieces added" open={Boolean(confirmId)} onCancel={() => setConfirmId("")} confirmLoading={busy} okButtonProps={{ disabled: !count || count <= 0 }} onOk={() => void run(async () => {
      await api(`/api/goods-in/intakes/${confirmId}/confirm`, jsonRequest("POST", { count })); setConfirmId(""); message.success("Receipt confirmed and stock recorded.");
    })}>
      <Text>Enter the number of pieces you added. For a first fill, this learns their actual unit weight from the stable scale measurement.</Text>
      <InputNumber aria-label="Pieces added" min={1} max={10000000} precision={0} value={count} onChange={setCount} style={{ width: "100%", marginTop: 20 }} />
    </Modal>
    <Modal title="Import a verified supplier catalogue" open={catalogueOpen} onCancel={() => setCatalogueOpen(false)} width={700} confirmLoading={busy} okButtonProps={{ disabled: !catalogueVerified || !catalogueJson.trim() }} onOk={() => void run(async () => {
      const products = JSON.parse(catalogueJson);
      await api("/api/goods-in/catalogue", jsonRequest("POST", { verified: catalogueVerified, products })); setCatalogueOpen(false); setCatalogueJson(""); setCatalogueVerified(false); message.success("Verified catalogue imported.");
    })}>
      <Text>Import a JSON array from product data you have verified. Required fields: supplier, partNumber and name. Optional fields include description, url, gtins, packageQuantity, unitWeightEstimate and metadata.</Text>
      <Input.TextArea aria-label="Verified supplier products JSON" rows={10} value={catalogueJson} onChange={event => setCatalogueJson(event.target.value)} style={{ marginTop: 16 }} />
      <Checkbox checked={catalogueVerified} onChange={event => setCatalogueVerified(event.target.checked)}>I verified these supplier product identities and metadata.</Checkbox>
    </Modal>
  </Flex>;
}
