import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button, Card, Flex, Select, Space, Tag } from "antd";
import type { Bin, Part } from "../types";
import type { StockAction } from "../uiTypes";
import { StockList } from "../components/StockList";

type StockStatus = "all" | "ready" | "low" | "offline" | "unassigned";
type StockSort = "name" | "category" | "quantity-low" | "quantity-high";

type StockViewProps = {
  bins: Bin[];
  parts: Part[];
  onAction: (bin: Bin, action: StockAction) => void;
  onAssign: (bin: Bin, partId: string, initialQuantity?: number) => void;
  onEmpty: (bin: Bin) => void;
  onRelearn: (bin: Bin, initialQuantity: number) => void;
  onTare: (bin: Bin) => void;
};

const uniqueOptions = (values: Array<string | null>) => [
  { value: "all", label: "All" },
  ...[...new Set(values.filter((value): value is string => Boolean(value) && value !== "Not applicable"))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }))
];

export function StockView({ bins, parts, onAction, onAssign, onEmpty, onRelearn, onTare }: StockViewProps) {
  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [headType, setHeadType] = useState("all");
  const [measurementSystem, setMeasurementSystem] = useState("all");
  const [diameter, setDiameter] = useState("all");
  const [length, setLength] = useState("all");
  const [status, setStatus] = useState<StockStatus>("all");
  const [sort, setSort] = useState<StockSort>("name");

  const categoryOptions = useMemo(() => {
    const options = uniqueOptions(bins.map((bin) => bin.part_category ?? "Other"));
    options[0].label = "All categories";
    return options;
  }, [bins]);

  const subcategoryOptions = useMemo(() => {
    const source = category === "all"
      ? bins
      : bins.filter((bin) => (bin.part_category ?? "Other") === category);
    const options = uniqueOptions(source.map((bin) => bin.part_subcategory));
    options[0].label = "All component types";
    return options;
  }, [bins, category]);

  const headTypeOptions = useMemo(() => {
    const source = bins.filter((bin) =>
      (category === "all" || (bin.part_category ?? "Other") === category) &&
      (subcategory === "all" || bin.part_subcategory === subcategory)
    );
    const options = uniqueOptions(source.map((bin) => bin.part_head_type));
    options[0].label = "All head types";
    return options;
  }, [bins, category, subcategory]);

  const systemOptions = useMemo(() => {
    const options = uniqueOptions(bins.map((bin) => bin.part_measurement_system));
    options[0].label = "Metric & imperial";
    return options;
  }, [bins]);

  const diameterOptions = useMemo(() => {
    const source = measurementSystem === "all"
      ? bins
      : bins.filter((bin) => bin.part_measurement_system === measurementSystem);
    const options = uniqueOptions(source.map((bin) => bin.part_nominal_diameter));
    options[0].label = "All diameters";
    return options;
  }, [bins, measurementSystem]);

  const lengthOptions = useMemo(() => {
    const source = measurementSystem === "all"
      ? bins
      : bins.filter((bin) => bin.part_measurement_system === measurementSystem);
    const options = uniqueOptions(source.map((bin) => bin.part_nominal_length));
    options[0].label = "All lengths";
    return options;
  }, [bins, measurementSystem]);

  const visibleBins = useMemo(() => {
    const filtered = bins.filter((bin) => {
      if (category !== "all" && (bin.part_category ?? "Other") !== category) return false;
      if (subcategory !== "all" && bin.part_subcategory !== subcategory) return false;
      if (headType !== "all" && bin.part_head_type !== headType) return false;
      if (measurementSystem !== "all" && bin.part_measurement_system !== measurementSystem) return false;
      if (diameter !== "all" && bin.part_nominal_diameter !== diameter) return false;
      if (length !== "all" && bin.part_nominal_length !== length) return false;
      if (status === "ready" && (!bin.online || !bin.part_id || bin.low_stock)) return false;
      if (status === "low" && !bin.low_stock) return false;
      if (status === "offline" && bin.online) return false;
      if (status === "unassigned" && bin.part_id) return false;
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (sort === "category") {
        return (left.part_category ?? "Other").localeCompare(right.part_category ?? "Other") ||
          (left.part_name ?? "").localeCompare(right.part_name ?? "");
      }
      if (sort === "quantity-low") {
        return (left.estimated_quantity ?? Number.MAX_SAFE_INTEGER) -
          (right.estimated_quantity ?? Number.MAX_SAFE_INTEGER);
      }
      if (sort === "quantity-high") {
        return (right.estimated_quantity ?? -1) - (left.estimated_quantity ?? -1);
      }
      return (left.part_name ?? "Unassigned").localeCompare(right.part_name ?? "Unassigned");
    });
  }, [
    bins,
    category,
    diameter,
    headType,
    length,
    measurementSystem,
    sort,
    status,
    subcategory
  ]);

  const clearFilters = () => {
    setCategory("all");
    setSubcategory("all");
    setHeadType("all");
    setMeasurementSystem("all");
    setDiameter("all");
    setLength("all");
    setStatus("all");
    setSort("name");
  };

  return (
    <section className="page-content" aria-label="Stock management">
      <Card
        className="stock-list-card"
        title={<Space><Filter size={20} />Stock inventory</Space>}
        extra={<Tag color="blue">{visibleBins.length} shown</Tag>}
      >
        <Flex gap={10} wrap="wrap" className="stock-filters">
          <Select
            size="large"
            value={category}
            options={categoryOptions}
            onChange={(value) => {
              setCategory(value);
              setSubcategory("all");
              setHeadType("all");
            }}
            aria-label="Filter by category"
          />
          <Select
            size="large"
            value={subcategory}
            options={subcategoryOptions}
            onChange={(value) => {
              setSubcategory(value);
              setHeadType("all");
            }}
            aria-label="Filter by component type"
          />
          <Select
            size="large"
            value={headType}
            options={headTypeOptions}
            onChange={setHeadType}
            aria-label="Filter by head type"
          />
          <Select
            size="large"
            value={measurementSystem}
            options={systemOptions}
            onChange={(value) => {
              setMeasurementSystem(value);
              setDiameter("all");
              setLength("all");
            }}
            aria-label="Filter by measurement standard"
          />
          <Select size="large" value={diameter} options={diameterOptions} onChange={setDiameter} aria-label="Filter by diameter" />
          <Select size="large" value={length} options={lengthOptions} onChange={setLength} aria-label="Filter by length" />
          <Select
            size="large"
            value={status}
            onChange={setStatus}
            aria-label="Filter by status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "ready", label: "Ready" },
              { value: "low", label: "Low stock" },
              { value: "offline", label: "Offline" },
              { value: "unassigned", label: "Unassigned" }
            ]}
          />
          <Select
            size="large"
            value={sort}
            onChange={setSort}
            aria-label="Sort stock"
            options={[
              { value: "name", label: "Sort: component" },
              { value: "category", label: "Sort: category" },
              { value: "quantity-low", label: "Sort: lowest quantity" },
              { value: "quantity-high", label: "Sort: highest quantity" }
            ]}
          />
          <Button size="large" onClick={clearFilters}>Clear filters</Button>
        </Flex>

        <StockList
          bins={visibleBins}
          parts={parts}
          onAction={onAction}
          onAssign={onAssign}
          onEmpty={onEmpty}
          onRelearn={onRelearn}
          onTare={onTare}
        />
      </Card>
    </section>
  );
}
