export type Bin = {
  hardware_target?: string | null;
  partition_layout?: string | null;
  bin_id: string;
  online: number;
  last_seen: string | null;
  firmware_version: string | null;
  device_state: string | null;
  ip_address: string | null;
  rssi: number | null;
  part_id: string | null;
  part_name: string | null;
  part_description: string | null;
  part_category: string | null;
  part_subcategory: string | null;
  part_head_type: string | null;
  part_measurement_system: string | null;
  part_nominal_diameter: string | null;
  part_nominal_length: string | null;
  net_weight_grams: number | null;
  estimated_quantity: number | null;
  measurement_stable: number;
  measurement_noise_counts: number | null;
  unit_weight_grams: number | null;
  reorder_level: number | null;
  low_stock: number;
};

export type Part = {
  part_id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  head_type: string;
  measurement_system: string;
  nominal_diameter: string;
  nominal_length: string;
  accu_product_code: string;
  accu_order_quantity: number;
  unit_weight_grams: number;
  weight_calibrated: number;
  weight_calibrated_at: string | null;
  reorder_level: number;
  category_path_json?: string;
  images_json?: string; source_supplier?: string; source_product_code?: string; source_url?: string;
  bin_count: number;
  total_quantity: number;
};

export type InventoryEvent = {
  event_id: string;
  bin_id: string;
  part_id: string | null;
  part_name: string | null;
  event_type: "observed_pick" | "observed_restock";
  quantity_delta: number;
  previous_quantity: number;
  new_quantity: number;
  created_at: string;
};

export type Command = {
  command_id: string;
  bin_id: string | null;
  command_type: string;
  status: string;
  message: string | null;
  created_at: string;
};

export type Firmware = {
  hardware_target: string | null;
  partition_layout: string | null;
  signature: string | null;
  firmware_id: string;
  version: string;
  original_name: string;
  sha256: string;
  size_bytes: number;
  source: "upload" | "automatic-build";
  created_at: string;
};

export type OtaStatus = {
  command_id: string;
  bin_id: string;
  state: string;
  progress: number;
  message: string | null;
  updated_at: string;
};

export type AutomaticDeployment = {
  firmware_id: string;
  version: string;
  bin_id: string;
  command_id: string | null;
  state: string;
  attempts: number;
  message: string | null;
  updated_at: string;
};

export type CloudSyncState = {
  available: boolean;
  masterEnabled: boolean;
  enabled: boolean;
  configured: boolean;
  configurationError: string | null;
  backupConfigured: boolean;
  siteId: string | null;
  companyName?: string | null;
  wallName?: string | null;
  running: boolean;
  pending: number;
  latestSequence: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastBackupAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
};

export type Dashboard = {
  summary: {
    total_bins: number;
    online_bins: number;
    offline_bins: number;
    unassigned_bins: number;
    low_stock_bins: number;
  };
  bins: Bin[];
  parts: Part[];
  events: InventoryEvent[];
  commands: Command[];
  firmware: Firmware[];
  ota: OtaStatus[];
  automaticDeployments: AutomaticDeployment[];
  mqtt: { connected: boolean; brokerUrl: string };
  cloudSync: CloudSyncState;
  automaticUpdates: {
    enabled: boolean;
    version: string | null;
    inbox: string;
    retryAfterMs: number;
    publishRetryAfterMs: number;
  };
};
