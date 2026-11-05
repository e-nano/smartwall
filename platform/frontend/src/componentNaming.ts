import { supportsDiameter, supportsHeadType, supportsLength } from "./componentTaxonomy";

const NOT_APPLICABLE = "Not applicable";

const TYPE_NAMES: Record<string, string> = {
  "Socket Cap Screws": "Socket Cap Screw",
  "Machine Screws": "Machine Screw",
  "Set / Grub Screws": "Set Screw",
  "Shoulder Screws": "Shoulder Screw",
  "Self-Tapping Screws": "Self-Tapping Screw",
  "Wood Screws": "Wood Screw",
  "Other Screws": "Screw",
  "Hex Bolts": "Hex Bolt",
  "Carriage Bolts": "Carriage Bolt",
  "Flange Bolts": "Flange Bolt",
  "Eye Bolts": "Eye Bolt",
  "U-Bolts": "U-Bolt",
  "Other Bolts": "Bolt",
  "Hex Nuts": "Hex Nut",
  "Locking Nuts": "Locking Nut",
  "Flange Nuts": "Flange Nut",
  "Wing Nuts": "Wing Nut",
  "Cap Nuts": "Cap Nut",
  "Other Nuts": "Nut",
  "Flat Washers": "Flat Washer",
  "Spring Washers": "Spring Washer",
  "Lock Washers": "Lock Washer",
  "Shoulder Washers": "Shoulder Washer",
  "Spacers": "Spacer",
  "Standoffs": "Standoff",
  "Other Washers & Spacers": "Washer / Spacer",
  "Threaded Rods": "Threaded Rod",
  "Studs": "Stud",
  "Threaded Bar": "Threaded Bar",
  "Other Threaded Rods & Studs": "Threaded Rod / Stud",
  "Dowel Pins": "Dowel Pin",
  "Clevis Pins": "Clevis Pin",
  "Spring Pins": "Spring Pin",
  "Taper Pins": "Taper Pin",
  "Other Pins": "Pin",
  "Blind Rivets": "Blind Rivet",
  "Solid Rivets": "Solid Rivet",
  "Rivet Nuts": "Rivet Nut",
  "Other Rivets": "Rivet",
  "Threaded Inserts": "Threaded Insert",
  "Helical Inserts": "Helical Insert",
  "Heat-Set Inserts": "Heat-Set Insert",
  "Self-Tapping Inserts": "Self-Tapping Insert",
  "Other Inserts": "Insert",
  "Internal Circlips": "Internal Circlip",
  "External Circlips": "External Circlip",
  "E-Clips": "E-Clip",
  "Retaining Rings": "Retaining Ring",
  "Other Circlips & Retaining Rings": "Circlip / Retaining Ring",
  "Drill Bits": "Drill Bit",
  "Taps": "Tap",
  "Dies": "Die",
  "Thread Gauges": "Thread Gauge",
  "Other Drilling & Tapping": "Drilling / Tapping Tool",
  "Clips": "Clip",
  "Clamps": "Clamp",
  "Brackets": "Bracket",
  "Plugs & Caps": "Plug / Cap",
  "Cable Ties": "Cable Tie",
  "Other Assembly Hardware": "Assembly Hardware",
  "Butt Hinges": "Butt Hinge",
  "Piano / Continuous Hinges": "Piano / Continuous Hinge",
  "Concealed Hinges": "Concealed Hinge",
  "Pivot Hinges": "Pivot Hinge",
  "Friction Hinges": "Friction Hinge",
  "Other Hinges": "Hinge",
  "Compression Springs": "Compression Spring",
  "Extension Springs": "Extension Spring",
  "Torsion Springs": "Torsion Spring",
  "Constant-Force Springs": "Constant-Force Spring",
  "Leaf Springs": "Leaf Spring",
  "Disc Springs": "Disc Spring",
  "Other Springs": "Spring",
  "Bearings": "Bearing",
  "Bushings": "Bushing",
  "Shafts": "Shaft",
  "Gears": "Gear",
  "Pulleys": "Pulley",
  "Other Linear & Rotary Components": "Linear / Rotary Component",
  "ESP32 Boards": "ESP32 Board",
  "Arduino Boards": "Arduino Board",
  "Single-Board Computers": "Single-Board Computer",
  "Camera Modules": "Camera Module",
  "E-Ink Displays": "E-Ink Display",
  "OLED Displays": "OLED Display",
  "LCD & TFT Displays": "LCD / TFT Display",
  "Addressable LEDs": "Addressable LED",
  "Discrete LEDs & Indicators": "LED / Indicator",
  "Panel-Mount Indicators": "Panel-Mount Indicator",
  "Push Buttons": "Push Button",
  "DC Barrel Connectors": "DC Barrel Connector",
  "Load Cells": "Load Cell",
  "Temperature Sensors": "Temperature Sensor",
  "Motion & Proximity Sensors": "Motion / Proximity Sensor",
  "Environmental Sensors": "Environmental Sensor",
  "Other Sensors": "Sensor",
  "Power Supplies & Regulators": "Power Supply / Regulator",
  "Communication Modules": "Communication Module",
  "Interface & Conversion Modules": "Interface / Conversion Module",
  "Relays & Switches": "Relay / Switch",
  "Motors & Drivers": "Motor / Driver",
  "Connectors": "Connector",
  "Cables & Wire": "Cable / Wire",
  "Passive Components": "Passive Component",
  "Semiconductors": "Semiconductor",
  "PCBs & Prototyping": "PCB / Prototyping Part",
  "Other Electronics": "Electronic Component",
  "Other": "Component"
};

const TYPE_CODES: Record<string, string> = {
  "Socket Cap Screws": "SCS",
  "Machine Screws": "MS",
  "Set / Grub Screws": "GRS",
  "Shoulder Screws": "SHS",
  "Self-Tapping Screws": "STS",
  "Wood Screws": "WS",
  "Hex Bolts": "HB",
  "Carriage Bolts": "CB",
  "Flange Bolts": "FB",
  "Eye Bolts": "EB",
  "U-Bolts": "UB",
  "Hex Nuts": "HN",
  "Locking Nuts": "LN",
  "Flange Nuts": "FN",
  "Wing Nuts": "WN",
  "Cap Nuts": "CN",
  "Flat Washers": "FW",
  "Spring Washers": "SW",
  "Lock Washers": "LW",
  "Shoulder Washers": "SHW",
  "Spacers": "SP",
  "Standoffs": "SO",
  "Threaded Rods": "TR",
  "Studs": "STD",
  "Threaded Bar": "TB",
  "Dowel Pins": "DP",
  "Clevis Pins": "CP",
  "Spring Pins": "SPN",
  "Taper Pins": "TP",
  "Blind Rivets": "BR",
  "Solid Rivets": "SR",
  "Rivet Nuts": "RN",
  "Threaded Inserts": "TI",
  "Helical Inserts": "HI",
  "Heat-Set Inserts": "HSI",
  "Self-Tapping Inserts": "STI",
  "Internal Circlips": "IC",
  "External Circlips": "EC",
  "E-Clips": "ECL",
  "Retaining Rings": "RR",
  "Drill Bits": "DB",
  "Taps": "TAP",
  "Dies": "DIE",
  "Thread Gauges": "TG",
  "Butt Hinges": "BH",
  "Piano / Continuous Hinges": "PH",
  "Concealed Hinges": "CH",
  "Pivot Hinges": "PVH",
  "Friction Hinges": "FH",
  "Other Hinges": "HINGE",
  "Compression Springs": "CSPR",
  "Extension Springs": "ESPR",
  "Torsion Springs": "TSPR",
  "Constant-Force Springs": "CFSPR",
  "Leaf Springs": "LSPR",
  "Disc Springs": "DSPR",
  "Other Springs": "SPR",
  "Bearings": "BRG",
  "Bushings": "BSH",
  "Shafts": "SFT",
  "Gears": "GR",
  "Pulleys": "PLY",
  "ESP32 Boards": "ESP32",
  "Arduino Boards": "ARD",
  "Single-Board Computers": "SBC",
  "Camera Modules": "CAM",
  "E-Ink Displays": "EINK",
  "OLED Displays": "OLED",
  "LCD & TFT Displays": "LCD",
  "Addressable LEDs": "ALED",
  "Discrete LEDs & Indicators": "LED",
  "Panel-Mount Indicators": "PMI",
  "Push Buttons": "PB",
  "DC Barrel Connectors": "DCJ",
  "Load Cells": "LC",
  "Temperature Sensors": "TSENS",
  "Motion & Proximity Sensors": "MPSENS",
  "Environmental Sensors": "ESENS",
  "Other Sensors": "SENS",
  "Power Supplies & Regulators": "PWR",
  "Communication Modules": "COMMS",
  "Interface & Conversion Modules": "IFACE",
  "Relays & Switches": "RLY",
  "Motors & Drivers": "MOTOR",
  "Connectors": "CONN",
  "Cables & Wire": "WIRE",
  "Passive Components": "PASS",
  "Semiconductors": "SEMI",
  "PCBs & Prototyping": "PCB",
  "Other Electronics": "ELEC"
};

type PartIdentityInput = {
  category: string;
  subcategory: string;
  headType: string;
  measurementSystem: string;
  nominalDiameter: string;
  nominalLength: string;
};

function fallbackCode(value: string) {
  const words = value
    .replace(/&/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word && !["and", "other"].includes(word.toLowerCase()));
  return (words.map((word) => word[0]).join("") || "PART").toUpperCase().slice(0, 6);
}

function idToken(value: string) {
  if (!value || value === NOT_APPLICABLE) return "";
  return value
    .toUpperCase()
    .replace(/^#/, "NO")
    .replace(/\//g, "-")
    .replace(/[^A-Z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function headAlreadyDescribed(headType: string, typeName: string) {
  const head = headType.toLowerCase().replace("flanged", "flange");
  const type = typeName.toLowerCase();
  return type.includes(head) ||
    (headType === "Headless / Grub" && type.includes("set screw")) ||
    (headType === "Socket Cap" && type.includes("socket cap"));
}

export function generatePartIdentity(input: PartIdentityInput) {
  const typeName = TYPE_NAMES[input.subcategory] ?? input.subcategory ?? input.category;
  const diameter = supportsDiameter(input.category) ? input.nominalDiameter : NOT_APPLICABLE;
  const length = supportsLength(input.category, input.subcategory)
    ? input.nominalLength
    : NOT_APPLICABLE;
  const size = [diameter, length]
    .filter((value) => value && value !== NOT_APPLICABLE)
    .join(" x ");
  const includeHead =
    supportsHeadType(input.category) &&
    input.headType &&
    ![NOT_APPLICABLE, "Other"].includes(input.headType) &&
    !headAlreadyDescribed(input.headType, typeName);
  const name = [size, includeHead ? `${input.headType} Head` : "", typeName]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const typeCode = TYPE_CODES[input.subcategory] ?? fallbackCode(input.subcategory || input.category);
  const headCode = includeHead ? idToken(input.headType.replace(" Head", "")) : "";
  const partId = [
    typeCode,
    headCode,
    idToken(diameter),
    idToken(length)
  ].filter(Boolean).join("-").slice(0, 64);

  return {
    name: name || "Component",
    partId: partId || "PART"
  };
}
