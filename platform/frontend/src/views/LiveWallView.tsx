import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Filter, Lightbulb, LightbulbOff, Search } from "lucide-react";
import { Alert, Button, Card, Flex, Input, Space, Tag, Typography } from "antd";
import type { InputRef } from "antd";
import type { Bin, Part } from "../types";
import type { StockAction } from "../uiTypes";
import { StockGrid } from "../components/StockGrid";

const { Text } = Typography;
const NOT_APPLICABLE = "Not applicable";

type LiveWallViewProps = {
  bins: Bin[];
  parts: Part[];
  query: string;
  searchInput: RefObject<InputRef | null>;
  onQueryChange: (value: string) => void;
  onAction: (bin: Bin, action: StockAction) => void;
  onAssign: (bin: Bin, partId: string, initialQuantity?: number) => void;
  onSetGroupLights: (bins: Bin[], active: boolean) => Promise<boolean>;
};

type LightSession = {
  key: string;
  label: string;
  binIds: string[];
  baselines: Record<string, number | null>;
  startedAt: number;
};

const searchableValues = (bin: Bin) => [
  bin.part_name,
  bin.part_category,
  bin.part_subcategory,
  bin.part_head_type,
  bin.part_measurement_system,
  bin.part_nominal_diameter,
  bin.part_nominal_length
];

const sortedValues = (values: Array<string | null>) =>
  [...new Set(values.filter((value): value is string => Boolean(value) && value !== NOT_APPLICABLE))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

export function LiveWallView({
  bins,
  parts,
  query,
  searchInput,
  onQueryChange,
  onAction,
  onAssign,
  onSetGroupLights
}: LiveWallViewProps) {
  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [headType, setHeadType] = useState("all");
  const [diameter, setDiameter] = useState("all");
  const [length, setLength] = useState("all");
  const [lightSession, setLightSession] = useState<LightSession | null>(null);
  const [lightsBusy, setLightsBusy] = useState(false);
  const lightSessionRef = useRef<LightSession | null>(null);
  const lightsBusyRef = useRef(false);

  const updateLightSession = (session: LightSession | null) => {
    lightSessionRef.current = session;
    setLightSession(session);
  };

  const categories = useMemo(
    () => sortedValues(bins.map((bin) => bin.part_category ?? "Unassigned")),
    [bins]
  );

  const subcategories = useMemo(() => {
    if (category === "all") return [];
    return sortedValues(
      bins
        .filter((bin) => (bin.part_category ?? "Unassigned") === category)
        .map((bin) => bin.part_subcategory ?? "Unassigned")
    );
  }, [bins, category]);

  const selectedTypeBins = useMemo(() => {
    if (category === "all" || subcategory === "all") return [];
    return bins.filter(
      (bin) =>
        (bin.part_category ?? "Unassigned") === category &&
        (bin.part_subcategory ?? "Unassigned") === subcategory
    );
  }, [bins, category, subcategory]);

  const headTypes = useMemo(
    () => sortedValues(selectedTypeBins.map((bin) => bin.part_head_type)),
    [selectedTypeBins]
  );

  const selectedHeadBins = useMemo(
    () => selectedTypeBins.filter(
      (bin) => headType === "all" || bin.part_head_type === headType
    ),
    [headType, selectedTypeBins]
  );

  const diameters = useMemo(
    () => sortedValues(selectedHeadBins.map((bin) => bin.part_nominal_diameter)),
    [selectedHeadBins]
  );

  const lengths = useMemo(
    () => sortedValues(
      selectedHeadBins
        .filter((bin) => diameter === "all" || bin.part_nominal_diameter === diameter)
        .map((bin) => bin.part_nominal_length)
    ),
    [diameter, selectedHeadBins]
  );

  const visibleBins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bins.filter((bin) => {
      if (
        needle &&
        !searchableValues(bin).some((value) => value?.toLowerCase().includes(needle))
      ) return false;
      if (category !== "all" && (bin.part_category ?? "Unassigned") !== category) return false;
      if (subcategory !== "all" && (bin.part_subcategory ?? "Unassigned") !== subcategory) return false;
      if (headType !== "all" && bin.part_head_type !== headType) return false;
      if (diameter !== "all" && bin.part_nominal_diameter !== diameter) return false;
      if (length !== "all" && bin.part_nominal_length !== length) return false;
      return true;
    });
  }, [bins, category, diameter, headType, length, query, subcategory]);

  const binsForSelection = (
    nextCategory = category,
    nextSubcategory = subcategory,
    nextHeadType = headType,
    nextDiameter = diameter,
    nextLength = length
  ) => {
    const needle = query.trim().toLowerCase();
    return bins.filter((bin) => {
      if (needle && !searchableValues(bin).some((value) => value?.toLowerCase().includes(needle))) return false;
      if (nextCategory !== "all" && (bin.part_category ?? "Unassigned") !== nextCategory) return false;
      if (nextSubcategory !== "all" && (bin.part_subcategory ?? "Unassigned") !== nextSubcategory) return false;
      if (nextHeadType !== "all" && bin.part_head_type !== nextHeadType) return false;
      if (nextDiameter !== "all" && bin.part_nominal_diameter !== nextDiameter) return false;
      if (nextLength !== "all" && bin.part_nominal_length !== nextLength) return false;
      return true;
    });
  };

  const stopSelectionLights = async () => {
    const session = lightSessionRef.current;
    if (!session || lightsBusyRef.current) return;
    lightsBusyRef.current = true;
    setLightsBusy(true);
    updateLightSession(null);
    const targets = bins.filter((bin) => session.binIds.includes(bin.bin_id));
    const stopped = await onSetGroupLights(targets, false);
    if (!stopped) updateLightSession(session);
    lightsBusyRef.current = false;
    setLightsBusy(false);
  };

  const startSelectionLights = async (key: string, label: string, targetBins: Bin[]) => {
    if (lightsBusyRef.current) return;
    if (lightSessionRef.current?.key === key) {
      await stopSelectionLights();
      return;
    }

    const onlineTargets = targetBins.filter((bin) => bin.online);
    if (onlineTargets.length === 0) {
      await onSetGroupLights([], true);
      return;
    }

    lightsBusyRef.current = true;
    setLightsBusy(true);
    const previous = lightSessionRef.current;
    if (previous) {
      const previousTargets = bins.filter((bin) => previous.binIds.includes(bin.bin_id));
      const stopped = await onSetGroupLights(previousTargets, false);
      if (!stopped) {
        lightsBusyRef.current = false;
        setLightsBusy(false);
        return;
      }
      updateLightSession(null);
    }

    const started = await onSetGroupLights(onlineTargets, true);
    if (started) {
      updateLightSession({
        key,
        label,
        binIds: onlineTargets.map((bin) => bin.bin_id),
        baselines: Object.fromEntries(
          onlineTargets.map((bin) => [bin.bin_id, bin.estimated_quantity])
        ),
        startedAt: Date.now()
      });
    }
    lightsBusyRef.current = false;
    setLightsBusy(false);
  };

  useEffect(() => {
    const session = lightSessionRef.current;
    if (!session || lightsBusyRef.current) return;
    const changed = session.binIds.some((binId) => {
      const baseline = session.baselines[binId];
      const current = bins.find((bin) => bin.bin_id === binId)?.estimated_quantity ?? null;
      return baseline !== null && current !== null && current !== baseline;
    });
    if (changed) void stopSelectionLights();
  }, [bins]);

  useEffect(() => {
    if (!lightSession) return;
    const remaining = Math.max(0, lightSession.startedAt + 300_000 - Date.now());
    const timer = window.setTimeout(() => void stopSelectionLights(), remaining);
    return () => window.clearTimeout(timer);
  }, [lightSession?.startedAt]);

  const chooseCategory = (value: string) => {
    setCategory(value);
    setSubcategory("all");
    setHeadType("all");
    setDiameter("all");
    setLength("all");
  };

  const chooseSubcategory = (value: string) => {
    setSubcategory(value);
    setHeadType("all");
    setDiameter("all");
    setLength("all");
  };

  const chooseHeadType = (value: string) => {
    setHeadType(value);
    setDiameter("all");
    setLength("all");
  };

  const chooseDiameter = (value: string) => {
    setDiameter(value);
    setLength("all");
  };

  const detailVisibility = {
    category: category === "all",
    subcategory: subcategory === "all",
    headType: headType === "all",
    diameter: diameter === "all",
    length: length === "all"
  };

  const filterOption = (
    key: string,
    label: string,
    selected: boolean,
    onSelect: () => void,
    targetBins: Bin[]
  ) => {
    const onlineCount = targetBins.filter((bin) => bin.online).length;
    const active = lightSession?.key === key;
    return (
      <Space.Compact key={key} className="wall-filter-option">
        <Button size="large" type={selected ? "primary" : "default"} onClick={onSelect}>
          {label}
        </Button>
        <Button
          size="large"
          type={active ? "primary" : "default"}
          className="filter-light-button"
          icon={active ? <LightbulbOff size={19} /> : <Lightbulb size={19} />}
          disabled={onlineCount === 0 || lightsBusy}
          loading={active && lightsBusy}
          aria-label={active ? `Stop lights for ${label}` : `Light ${onlineCount} online bins matching ${label}`}
          aria-pressed={active}
          title={active ? `Stop lights for ${label}` : `Light ${onlineCount} matching online bins`}
          onClick={() => void startSelectionLights(key, label, targetBins)}
        />
      </Space.Compact>
    );
  };

  return (
    <section className="page-content wall-page" aria-label="Live wall">
      <Card
        className="wall-filter-card"
        title={<Space><Filter size={20} />Find components</Space>}
        extra={
          <Space wrap>
            <Tag color="blue">{visibleBins.length} shown</Tag>
            {lightSession && (
              <Button
                danger
                size="large"
                icon={<LightbulbOff size={19} />}
                loading={lightsBusy}
                onClick={() => void stopSelectionLights()}
              >
                Stop lights
              </Button>
            )}
          </Space>
        }
      >
        <Input
          ref={searchInput}
          className="wall-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          prefix={<Search size={20} />}
          allowClear
          size="large"
          placeholder="Search by component, category, type, head, diameter, or length"
          aria-label="Search live wall components"
        />

        {lightSession && (
          <Alert
            showIcon
            type="warning"
            message={`Lighting ${lightSession.binIds.length} bin${lightSession.binIds.length === 1 ? "" : "s"}: ${lightSession.label}`}
            description="All selection lights stop when one highlighted bin records a stable quantity change, after five minutes, or when you press Stop lights."
          />
        )}

        <Flex vertical gap={10} className="wall-filter-step">
          <Text strong>1. Category</Text>
          <Flex gap={8} wrap="wrap">
            {filterOption(
              "category:all",
              "All categories",
              category === "all",
              () => chooseCategory("all"),
              binsForSelection("all", "all", "all", "all", "all")
            )}
            {categories.map((value) => filterOption(
              `category:${value}`,
              value,
              category === value,
              () => chooseCategory(value),
              binsForSelection(value, "all", "all", "all", "all")
            ))}
          </Flex>
        </Flex>

        {category !== "all" && (
          <Flex vertical gap={10} className="wall-filter-step">
            <Text strong>2. Type</Text>
            <Flex gap={8} wrap="wrap">
              {filterOption(
                `type:${category}:all`,
                `All ${category}`,
                subcategory === "all",
                () => chooseSubcategory("all"),
                binsForSelection(category, "all", "all", "all", "all")
              )}
              {subcategories.map((value) => filterOption(
                `type:${category}:${value}`,
                value,
                subcategory === value,
                () => chooseSubcategory(value),
                binsForSelection(category, value, "all", "all", "all")
              ))}
            </Flex>
          </Flex>
        )}

        {headTypes.length > 0 && (
          <Flex vertical gap={10} className="wall-filter-step">
            <Text strong>3. Head type</Text>
            <Flex gap={8} wrap="wrap">
              {filterOption(
                `head:${category}:${subcategory}:all`,
                "All head types",
                headType === "all",
                () => chooseHeadType("all"),
                binsForSelection(category, subcategory, "all", "all", "all")
              )}
              {headTypes.map((value) => filterOption(
                `head:${category}:${subcategory}:${value}`,
                value,
                headType === value,
                () => chooseHeadType(value),
                binsForSelection(category, subcategory, value, "all", "all")
              ))}
            </Flex>
          </Flex>
        )}

        {diameters.length > 0 && (
          <Flex vertical gap={10} className="wall-filter-step">
            <Text strong>{headTypes.length > 0 ? "4" : "3"}. Diameter / thread size</Text>
            <Flex gap={8} wrap="wrap">
              {filterOption(
                `diameter:${category}:${subcategory}:${headType}:all`,
                "All diameters",
                diameter === "all",
                () => chooseDiameter("all"),
                binsForSelection(category, subcategory, headType, "all", "all")
              )}
              {diameters.map((value) => filterOption(
                `diameter:${category}:${subcategory}:${headType}:${value}`,
                value,
                diameter === value,
                () => chooseDiameter(value),
                binsForSelection(category, subcategory, headType, value, "all")
              ))}
            </Flex>
          </Flex>
        )}

        {lengths.length > 0 && (
          <Flex vertical gap={10} className="wall-filter-step">
            <Text strong>
              {3 + (headTypes.length > 0 ? 1 : 0) + (diameters.length > 0 ? 1 : 0)}. Length
            </Text>
            <Flex gap={8} wrap="wrap">
              {filterOption(
                `length:${category}:${subcategory}:${headType}:${diameter}:all`,
                "All lengths",
                length === "all",
                () => setLength("all"),
                binsForSelection(category, subcategory, headType, diameter, "all")
              )}
              {lengths.map((value) => filterOption(
                `length:${category}:${subcategory}:${headType}:${diameter}:${value}`,
                value,
                length === value,
                () => setLength(value),
                binsForSelection(category, subcategory, headType, diameter, value)
              ))}
            </Flex>
          </Flex>
        )}
      </Card>

      <StockGrid
        bins={visibleBins}
        parts={parts}
        compact
        expandable
        onAction={onAction}
        onAssign={onAssign}
        emptyTitle="No matching components"
        emptyBody="Try another search or choose broader category, type, head, diameter, or length filters."
        detailVisibility={detailVisibility}
      />
    </section>
  );
}
