export const COMPONENT_TAXONOMY = [
  { category: "Screws", subcategories: ["Socket Cap Screws", "Machine Screws", "Set / Grub Screws", "Shoulder Screws", "Self-Tapping Screws", "Wood Screws", "Other Screws"] },
  { category: "Bolts", subcategories: ["Hex Bolts", "Carriage Bolts", "Flange Bolts", "Eye Bolts", "U-Bolts", "Other Bolts"] },
  { category: "Nuts", subcategories: ["Hex Nuts", "Locking Nuts", "Flange Nuts", "Wing Nuts", "Cap Nuts", "Other Nuts"] },
  { category: "Washers & Spacers", subcategories: ["Flat Washers", "Spring Washers", "Lock Washers", "Shoulder Washers", "Spacers", "Standoffs", "Other Washers & Spacers"] },
  { category: "Threaded Rods & Studs", subcategories: ["Threaded Rods", "Studs", "Threaded Bar", "Other Threaded Rods & Studs"] },
  { category: "Pins", subcategories: ["Dowel Pins", "Clevis Pins", "Spring Pins", "Taper Pins", "Other Pins"] },
  { category: "Rivets & Rivet Nuts", subcategories: ["Blind Rivets", "Solid Rivets", "Rivet Nuts", "Other Rivets"] },
  { category: "Inserts", subcategories: ["Threaded Inserts", "Helical Inserts", "Heat-Set Inserts", "Self-Tapping Inserts", "Other Inserts"] },
  { category: "Circlips & Retaining Rings", subcategories: ["Internal Circlips", "External Circlips", "E-Clips", "Retaining Rings", "Other Circlips & Retaining Rings"] },
  { category: "Drilling & Tapping", subcategories: ["Drill Bits", "Taps", "Dies", "Thread Gauges", "Other Drilling & Tapping"] },
  { category: "Assembly Hardware", subcategories: ["Clips", "Clamps", "Brackets", "Plugs & Caps", "Cable Ties", "Other Assembly Hardware"] },
  { category: "Hinges", subcategories: ["Butt Hinges", "Piano / Continuous Hinges", "Concealed Hinges", "Pivot Hinges", "Friction Hinges", "Other Hinges"] },
  { category: "Springs", subcategories: ["Compression Springs", "Extension Springs", "Torsion Springs", "Constant-Force Springs", "Leaf Springs", "Disc Springs", "Other Springs"] },
  { category: "Linear & Rotary Components", subcategories: ["Bearings", "Bushings", "Shafts", "Gears", "Pulleys", "Other Linear & Rotary Components"] },
  {
    category: "Electronics",
    subcategories: [
      "ESP32 Boards",
      "Arduino Boards",
      "Single-Board Computers",
      "Camera Modules",
      "E-Ink Displays",
      "OLED Displays",
      "LCD & TFT Displays",
      "Addressable LEDs",
      "Discrete LEDs & Indicators",
      "Panel-Mount Indicators",
      "Push Buttons",
      "DC Barrel Connectors",
      "Load Cells",
      "Temperature Sensors",
      "Motion & Proximity Sensors",
      "Environmental Sensors",
      "Other Sensors",
      "Power Supplies & Regulators",
      "Communication Modules",
      "Interface & Conversion Modules",
      "Relays & Switches",
      "Motors & Drivers",
      "Connectors",
      "Cables & Wire",
      "Passive Components",
      "Semiconductors",
      "PCBs & Prototyping",
      "Other Electronics"
    ]
  },
  { category: "Other", subcategories: ["Other"] }
] as const;

export const METRIC_DIAMETERS = [
  "M1", "M1.2", "M1.4", "M1.6", "M1.8", "M2", "M2.5", "M3", "M3.5", "M4",
  "M4.5", "M5", "M6", "M7", "M8", "M10", "M12", "M14", "M16", "M18",
  "M20", "M22", "M24", "M27", "M30", "M33", "M36"
] as const;

export const IMPERIAL_DIAMETERS = [
  "#0", "#1", "#2", "#3", "#4", "#5", "#6", "#8", "#10", "#12",
  "1/4 in", "5/16 in", "3/8 in", "7/16 in", "1/2 in", "9/16 in",
  "5/8 in", "3/4 in", "7/8 in", "1 in", "1 1/8 in", "1 1/4 in"
] as const;

export const METRIC_LENGTHS = [
  "2 mm", "3 mm", "4 mm", "5 mm", "6 mm", "8 mm", "10 mm", "12 mm",
  "14 mm", "16 mm", "18 mm", "20 mm", "25 mm", "30 mm", "35 mm", "40 mm",
  "45 mm", "50 mm", "55 mm", "60 mm", "65 mm", "70 mm", "75 mm", "80 mm",
  "90 mm", "100 mm", "120 mm", "150 mm", "200 mm", "250 mm", "300 mm",
  "500 mm", "1000 mm"
] as const;

export const IMPERIAL_LENGTHS = [
  "1/8 in", "3/16 in", "1/4 in", "5/16 in", "3/8 in", "1/2 in", "5/8 in",
  "3/4 in", "7/8 in", "1 in", "1 1/4 in", "1 1/2 in", "1 3/4 in", "2 in",
  "2 1/2 in", "3 in", "3 1/2 in", "4 in", "5 in", "6 in", "8 in", "10 in",
  "12 in", "18 in", "24 in", "36 in"
] as const;

const DIAMETER_CATEGORIES = new Set([
  "Screws",
  "Bolts",
  "Nuts",
  "Washers & Spacers",
  "Threaded Rods & Studs",
  "Pins",
  "Rivets & Rivet Nuts",
  "Inserts",
  "Circlips & Retaining Rings",
  "Drilling & Tapping"
]);

const LENGTH_CATEGORIES = new Set([
  "Screws",
  "Bolts",
  "Threaded Rods & Studs",
  "Pins",
  "Rivets & Rivet Nuts",
  "Inserts"
]);

const HEAD_TYPES: Record<string, readonly string[]> = {
  Screws: [
    "Socket Cap",
    "Button",
    "Countersunk",
    "Pan",
    "Cheese",
    "Hex",
    "Flanged Hex",
    "Round",
    "Truss",
    "Headless / Grub",
    "Other"
  ],
  Bolts: [
    "Hex",
    "Flanged Hex",
    "Socket Cap",
    "Button",
    "Countersunk",
    "Carriage",
    "Eye",
    "T-Head",
    "Other"
  ],
  "Rivets & Rivet Nuts": [
    "Dome",
    "Countersunk",
    "Large Flange",
    "Flat",
    "Other"
  ]
};

export const categoryOptions = COMPONENT_TAXONOMY.map(({ category }) => ({
  value: category,
  label: category
}));

export const measurementSystemOptions = [
  { value: "Metric", label: "Metric" },
  { value: "Imperial", label: "Imperial" },
  { value: "Not applicable", label: "Not applicable" }
];

export function subcategoryOptions(category: string) {
  const group = COMPONENT_TAXONOMY.find((item) => item.category === category);
  return (group?.subcategories ?? ["Other"]).map((subcategory) => ({
    value: subcategory,
    label: subcategory
  }));
}

export function supportsDiameter(category: string) {
  return DIAMETER_CATEGORIES.has(category);
}

export function supportsLength(category: string, subcategory = "") {
  if (LENGTH_CATEGORIES.has(category)) return true;
  if (category === "Washers & Spacers") return ["Spacers", "Standoffs"].includes(subcategory);
  if (category === "Drilling & Tapping") return subcategory === "Drill Bits";
  if (category === "Linear & Rotary Components") return subcategory === "Shafts";
  return false;
}

export function supportsHeadType(category: string) {
  return Boolean(HEAD_TYPES[category]);
}

export function headTypeOptions(category: string) {
  return (HEAD_TYPES[category] ?? ["Not applicable"]).map((headType) => ({
    value: headType,
    label: headType
  }));
}

export function diameterOptions(measurementSystem: string) {
  const diameters =
    measurementSystem === "Metric"
      ? METRIC_DIAMETERS
      : measurementSystem === "Imperial"
        ? IMPERIAL_DIAMETERS
        : ["Not applicable"];
  return diameters.map((diameter) => ({ value: diameter, label: diameter }));
}

export function lengthOptions(measurementSystem: string) {
  const lengths =
    measurementSystem === "Metric"
      ? METRIC_LENGTHS
      : measurementSystem === "Imperial"
        ? IMPERIAL_LENGTHS
        : ["Not applicable"];
  return lengths.map((length) => ({ value: length, label: length }));
}

export function defaultDiameter(measurementSystem: string) {
  return measurementSystem === "Metric" ? "M5" : measurementSystem === "Imperial" ? "1/4 in" : "Not applicable";
}

export function defaultLength(measurementSystem: string) {
  return measurementSystem === "Metric" ? "20 mm" : measurementSystem === "Imperial" ? "1 in" : "Not applicable";
}
