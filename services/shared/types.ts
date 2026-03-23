export type TelemetryStatus = "GOOD" | "BAD" | "UNCERTAIN";

export interface UnsTopicSegments {
  enterprise: string;
  site: string;
  area: string;
  line: string;
  cell: string;
  asset: string;
  class: string;
  tag: string;
}

export interface UnsTopicSuffix {
  line: string;
  cell: string;
  asset: string;
  class: string;
  tag: string;
}

export interface TelemetryPayload {
  ts: string;
  value: number;
  unit?: string;
  status?: TelemetryStatus;
  seq?: number;
}

export interface AssetPointDefinition {
  class: string;
  tag: string;
  unit: string;
}

export interface AssetDefinition {
  asset: string;
  points: AssetPointDefinition[];
}
