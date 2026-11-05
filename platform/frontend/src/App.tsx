import { componentCategoryPath } from "./categoryPaths";
import { GoodsInView } from "./views/GoodsInView";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App as AntApp, ConfigProvider, Flex, Spin, Typography } from "antd";
import type { InputRef } from "antd";
import { api, jsonRequest } from "./api";
import type { Bin, CloudSyncState, Dashboard, Firmware, Part } from "./types";
import type { FirmwareFormValues, PartFormValues, StockAction, ViewKey } from "./uiTypes";
import { AppShell } from "./components/AppShell";
import { AnalysisView } from "./views/AnalysisView";
import { ComponentsView } from "./views/ComponentsView";
import { LiveWallView } from "./views/LiveWallView";
import { OrdersView } from "./views/OrdersView";
import { StockView } from "./views/StockView";
import { UpdatesView } from "./views/UpdatesView";
import { HelpView } from "./views/HelpView";
import { useScannerInput } from "./useScannerInput";

const { Text } = Typography;

function SmartWallApplication() {
  const { message, modal } = AntApp.useApp();
  const [view, setView] = useState<ViewKey>("overview");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedBins, setSelectedBins] = useState<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);
  const searchInput = useRef<InputRef | null>(null);
  const [incomingScan, setIncomingScan] = useState<{ raw: string; id: number } | null>(null);
  const scanSequence = useRef(0);
  const receiveScan = useCallback((raw: string) => {
    setIncomingScan({ raw, id: ++scanSequence.current });
    setView("goods-in");
  }, []);
  useScannerInput(receiveScan);
  const scanHandled = useCallback((id: number) => {
    setIncomingScan(current => current?.id === id ? null : current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setData(await api<Dashboard>("/api/dashboard"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const stream = new EventSource("/api/stream");
    const schedule = () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refresh(), 180);
    };

    ["broker", "status", "telemetry", "acks", "ota", "command", "firmware", "automatic-update", "cloud-sync", "goods-in", "parts"].forEach((event) => {
      stream.addEventListener(event, schedule);
    });

    return () => {
      stream.close();
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    const refreshCloudSync = async () => {
      try {
        const cloudSync = await api<CloudSyncState>("/api/sync/status");
        setData((current) => current ? { ...current, cloudSync } : current);
      } catch {
        // The main dashboard error handling reports connectivity failures.
      }
    };
    const interval = window.setInterval(() => void refreshCloudSync(), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInput.current?.input) {
        setQuery("");
        searchInput.current?.blur();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredBins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !data) return data?.bins ?? [];
    return data.bins.filter((bin) =>
      [
        bin.bin_id,
        bin.part_id,
        bin.part_name,
        bin.part_category,
        bin.part_subcategory,
        bin.part_head_type,
        bin.part_measurement_system,
        bin.part_nominal_diameter,
        bin.part_nominal_length
      ].some((value) => value?.toLowerCase().includes(needle))
    );
  }, [data, query]);

  const filteredParts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !data) return data?.parts ?? [];
    return data.parts.filter((part) =>
      [
        part.part_id,
        part.name,
        part.description,
        part.category,
        ...componentCategoryPath(part),
        part.head_type,
        part.measurement_system,
        part.nominal_diameter,
        part.nominal_length,
        part.accu_product_code
      ].some((value) => value?.toLowerCase().includes(needle))
    );
  }, [data, query]);

  const command = async (path: string, body: unknown, success: string, method = "POST") => {
    try {
      await api(path, jsonRequest(method, body));
      message.success(success);
      await refresh();
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Command failed");
      return false;
    }
  };

  const findBin = (bin: Bin, action: StockAction) => {
    const label = action === "pick" ? "Guided pick" : action === "restock" ? "Guided restock" : "Find light";
    void command(
      `/api/bins/${bin.bin_id}/find`,
      { active: true, timeoutSeconds: 90, action },
      `${label} started for ${bin.part_name ?? "this component"}`
    );
  };

  const setGroupLights = async (bins: Bin[], active: boolean) => {
    const onlineBinIds = bins.filter((bin) => bin.online).map((bin) => bin.bin_id);
    if (onlineBinIds.length === 0) {
      message.warning("No matching bins are online");
      return false;
    }
    try {
      await api("/api/bins/lights", jsonRequest("POST", {
        binIds: onlineBinIds,
        active,
        timeoutSeconds: 300
      }));
      message.success(
        active
          ? `${onlineBinIds.length} matching bin light${onlineBinIds.length === 1 ? "" : "s"} turned on`
          : "Selection lights stopped"
      );
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not control selection lights");
      return false;
    }
  };

  const assign = (bin: Bin, partId: string, initialQuantity?: number) => {
    void command(
      `/api/bins/${bin.bin_id}/assign`,
      initialQuantity === undefined ? { partId } : { partId, initialQuantity },
      initialQuantity === undefined ? "Component assigned" : `Quantity learned from ${initialQuantity} pieces`
    );
  };

  const relearn = (bin: Bin, initialQuantity: number) => {
    void command(
      `/api/bins/${bin.bin_id}/relearn-weight`,
      { initialQuantity },
      `Quantity recalibrated from ${initialQuantity} pieces`
    );
  };

  const emptyBin = (bin: Bin) => {
    modal.confirm({
      title: `Empty ${bin.part_name ?? "this stock location"}?`,
      content: "Remove the physical contents first. The component remains in the catalog.",
      okText: "Empty stock",
      okButtonProps: { danger: true, size: "large" },
      cancelButtonProps: { size: "large" },
      onOk: () => command(`/api/bins/${bin.bin_id}/empty`, {}, `${bin.part_name ?? "Stock location"} cleared`)
    });
  };

  const tareBin = (bin: Bin) => {
    modal.confirm({
      title: `Tare ${bin.part_name ?? "this stock location"}?`,
      content: "Remove everything from the bin, then leave it empty and completely still while the tare measurement runs.",
      okText: "Start tare",
      okButtonProps: { size: "large" },
      cancelButtonProps: { size: "large" },
      onOk: () => command(
        `/api/bins/${bin.bin_id}/tare`,
        {},
        "Tare started — keep the empty bin still"
      )
    });
  };

  const createPart = (values: PartFormValues) => {
    return command(
      "/api/parts",
      {
        images: values.images ?? [], sourceSupplier: values.sourceSupplier ?? "", sourceProductCode: values.sourceProductCode ?? "", sourceUrl: values.sourceUrl ?? "",
        categoryPath: [values.category,values.subcategory,...(values.nestedTypes ?? [])],
        partId: values.partId,
        name: values.name,
        description: values.description ?? "",
        category: values.category,
        subcategory: values.subcategory,
        headType: values.headType,
        measurementSystem: values.measurementSystem,
        nominalDiameter: values.nominalDiameter,
        nominalLength: values.nominalLength,
        accuProductCode: values.accuProductCode ?? "",
        accuOrderQuantity: values.accuOrderQuantity ?? 0,
        reorderLevel: values.reorderLevel
      },
      "Component added to the catalog"
    );
  };

  const classifyPart = (
    partId: Part["part_id"],
    name: string,
    category: string,
    subcategory: string,
    headType: string,
    measurementSystem: string,
    nominalDiameter: string,
    nominalLength: string,
    accuProductCode: string,
    accuOrderQuantity: number,
    categoryPath: string[]
  ) => {
    return command(
      `/api/parts/${encodeURIComponent(partId)}/classification`,
      {
        name,
        category,
        subcategory,
        headType,
        measurementSystem,
        nominalDiameter,
        nominalLength,
        accuProductCode,
        accuOrderQuantity,
        categoryPath
      },
      "Component classification updated",
      "PATCH"
    );
  };

  const uploadFirmware = async (values: FirmwareFormValues) => {
    const binary = values.firmware?.[0]?.originFileObj;
    if (!binary) {
      message.error("Choose firmware.bin");
      return false;
    }

    const body = new FormData();
    const manifest = values.manifest?.[0]?.originFileObj;
    if (!manifest) { message.error("Choose the firmware manifest JSON"); return false; }
    body.append("manifest", await manifest.text());
    body.append("firmware", binary);

    try {
      await api<Firmware>("/api/firmware", { method: "POST", body });
      message.success("Firmware verified and imported");
      await refresh();
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Upload failed");
      return false;
    }
  };

  const deploy = async (firmware: Firmware, all: boolean) => {
    const onlineSelected = [...selectedBins].filter((id) =>
      data?.bins.some((bin) => bin.bin_id === id && bin.online)
    );

    await command(
      `/api/firmware/${firmware.firmware_id}/deploy`,
      { target: all ? "all" : "selected", binIds: all ? [] : onlineSelected, force: false },
      all
        ? `Rollout of ${firmware.version} to compatible bins started`
        : `Update sent to ${onlineSelected.length} device${onlineSelected.length === 1 ? "" : "s"}`
    );
  };

  const updateCloudSync = async (enabled: boolean) => {
    const apply = async () => {
      try {
        const cloudSync = await api<CloudSyncState>(
          "/api/sync/settings",
          jsonRequest("PATCH", { enabled })
        );
        setData((current) => current ? { ...current, cloudSync } : current);
        message.success(enabled ? "Cloud sync enabled" : "Cloud sync paused; local changes remain queued");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "Could not update cloud sync");
        throw error;
      }
    };

    if (!enabled) {
      await apply();
      return;
    }
    modal.confirm({
      title: "Enable cloud sync?",
      content: "Parts, bin state, inventory history, firmware metadata, and encrypted SQLite backups will be sent to the configured SmartWall cloud project.",
      okText: "Enable sync",
      cancelText: "Keep paused",
      okButtonProps: { size: "large" },
      cancelButtonProps: { size: "large" },
      onOk: apply
    });
  };

  const syncNow = async () => {
    try {
      const cloudSync = await api<CloudSyncState>("/api/sync/run", { method: "POST" });
      setData((current) => current ? { ...current, cloudSync } : current);
      message.success("Cloud synchronization started");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not start cloud sync");
    }
  };

  if (loading || !data) {
    return (
      <Flex className="loading-screen" vertical align="center" justify="center" gap={14}>
        <Spin size="large" />
        <Text>Connecting to SmartWall...</Text>
      </Flex>
    );
  }

  let content: ReactNode;
  switch (view) {
    case "goods-in":
      content = <GoodsInView bins={data.bins} parts={data.parts} onRefresh={refresh} incomingScan={incomingScan} onScanHandled={scanHandled} />;
      break;
    case "analysis":
      content = <AnalysisView data={data} />;
      break;
    case "bins":
      content = (
        <StockView
          bins={filteredBins}
          parts={data.parts}
          onAction={findBin}
          onAssign={assign}
          onEmpty={emptyBin}
          onRelearn={relearn}
          onTare={tareBin}
        />
      );
      break;
    case "catalog":
      content = <ComponentsView parts={filteredParts} taxonomyParts={data.parts} onCreate={createPart} onClassify={classifyPart} onImages={(partId,images)=>command(`/api/parts/${encodeURIComponent(partId)}/images`,{ images },"Component images saved","PUT")} />;
      break;
    case "orders":
      content = <OrdersView parts={data.parts} onOpenComponents={() => setView("catalog")} />;
      break;
    case "updates":
      content = (
        <UpdatesView
          data={data}
          selectedBins={selectedBins}
          setSelectedBins={setSelectedBins}
          onUpload={uploadFirmware}
          onDeploy={deploy}
        />
      );
      break;
    case "help":
      content = <HelpView />;
      break;
    default:
      content = (
        <LiveWallView
          bins={data.bins}
          parts={data.parts}
          query={query}
          searchInput={searchInput}
          onQueryChange={setQuery}
          onAction={findBin}
          onAssign={assign}
          onSetGroupLights={setGroupLights}
        />
      );
  }

  return (
    <AppShell
      data={data}
      view={view}
      query={query}
      searchInput={searchInput}
      onQueryChange={setQuery}
      onViewChange={setView}
      onRefresh={() => void refresh()}
      onCloudSyncChange={(enabled) => void updateCloudSync(enabled)}
      onCloudSyncNow={() => void syncNow()}
    >
      {content}
    </AppShell>
  );
}

export function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#2563eb",
          colorSuccess: "#0f766e",
          colorWarning: "#c96b08",
          colorError: "#c2413a",
          colorBgLayout: "#eef2f7",
          borderRadius: 14,
          fontSize: 16,
          fontSizeSM: 14,
          fontSizeLG: 18,
          controlHeight: 48,
          controlHeightLG: 56,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        },
        components: {
          Layout: { siderBg: "#111827", headerBg: "#f8fafc" },
          Menu: { darkItemBg: "#111827", darkItemSelectedBg: "#2563eb", darkItemHoverBg: "#1e293b" },
          Card: { headerHeight: 64 }
        }
      }}
    >
      <AntApp>
        <SmartWallApplication />
      </AntApp>
    </ConfigProvider>
  );
}
