export type FirmwareMetadata = { version: string; hardwareTarget: string; partitionLayout: string; sha256: string; sizeBytes: number; signature?: string; url?: string };
export const hardwareLayouts: Readonly<Record<string, string>>;
export function firmwareMessage(m: FirmwareMetadata): string;
export function verifyFirmware(m: FirmwareMetadata, bytes: Buffer, publicKey: string | Buffer | null, allowUnsigned?: boolean): FirmwareMetadata;
export function assertCompatible(firmware: { hardware_target: string | null; partition_layout: string | null }, bin: { hardware_target: string | null; partition_layout: string | null } | undefined): void;
