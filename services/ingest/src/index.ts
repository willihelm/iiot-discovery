import mqtt from "mqtt";
import { InfluxDB, Point } from "@influxdata/influxdb-client";
import { decodeSparkplugPayload, parseSparkplugTopic } from "../../shared/sparkplug.js";
import { type TelemetryStatus } from "../../shared/types.js";
import { parseUnsTopic } from "../../shared/uns.js";

interface IngestPayloadCandidate {
  ts?: string;
  value?: unknown;
  unit?: string;
  status?: string;
  seq?: number;
}

const MQTT_URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "uns/v1/acme/berlin/packaging";
const MQTT_SUB_TOPICS = [`${MQTT_TOPIC_PREFIX}/#`, "spBv1.0/#"];

const INFLUX_URL = process.env.INFLUX_URL || "http://influxdb:8086";
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || "";
const INFLUX_ORG = process.env.INFLUX_ORG || process.env.INFLUXDB_ORG || "acme";
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || process.env.INFLUXDB_BUCKET || "iiot";
const INFLUX_MEASUREMENT = process.env.INFLUX_MEASUREMENT || "telemetry";
const SPARKPLUG_MEASUREMENT = process.env.SPARKPLUG_MEASUREMENT || "sparkplug_telemetry";

if (!INFLUX_TOKEN) {
  console.error("Missing INFLUX_TOKEN");
  process.exit(1);
}

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, "ms");
writeApi.useDefaultTags({ source: "mqtt-ingest" });

function parseTs(ts?: string): Date | null {
  if (!ts) return null;

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTelemetryStatus(value: unknown): value is TelemetryStatus {
  return value === "GOOD" || value === "BAD" || value === "UNCERTAIN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePayload(payloadBuf: Buffer): IngestPayloadCandidate | null {
  let value: unknown;

  try {
    value = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const payload: IngestPayloadCandidate = {};

  if (typeof value.ts === "string") payload.ts = value.ts;
  if (typeof value.value === "number" || typeof value.value === "string") payload.value = value.value;
  if (typeof value.unit === "string") payload.unit = value.unit;
  if (typeof value.status === "string") payload.status = value.status;
  if (typeof value.seq === "number") payload.seq = value.seq;

  return payload;
}

function parseSparkplugMetricName(metricName?: string, alias?: number): string {
  const trimmed = safeString(metricName);
  if (trimmed) return trimmed;
  if (typeof alias === "number") return `alias_${alias}`;
  return "unknown_metric";
}

function writeSparkplugPoints(topic: string, payloadBuf: Buffer): void {
  const sparkplugTopic = parseSparkplugTopic(topic);
  if (!sparkplugTopic) return;

  let payload;
  try {
    payload = decodeSparkplugPayload(payloadBuf);
  } catch (error) {
    console.error("Sparkplug payload decode error", error);
    return;
  }

  for (const metric of payload.metrics) {
    const metricName = parseSparkplugMetricName(metric.name, metric.alias);
    const point = new Point(SPARKPLUG_MEASUREMENT)
      .tag("namespace", sparkplugTopic.namespace)
      .tag("group_id", sparkplugTopic.groupId)
      .tag("message_type", sparkplugTopic.messageType)
      .tag("edge_node_id", sparkplugTopic.edgeNodeId)
      .tag("metric_name", metricName);

    if (sparkplugTopic.deviceId) point.tag("device_id", sparkplugTopic.deviceId);
    if (typeof metric.alias === "number") point.tag("metric_alias", String(metric.alias));
    if (typeof metric.datatype === "number") point.tag("datatype", String(metric.datatype));

    const ts = typeof metric.timestamp === "number"
      ? new Date(metric.timestamp)
      : typeof payload.timestamp === "number"
        ? new Date(payload.timestamp)
        : null;

    if (typeof metric.value === "number" && Number.isFinite(metric.value)) {
      point.floatField("value", metric.value);
    } else if (typeof metric.value === "bigint") {
      point.floatField("value", Number(metric.value));
    } else if (typeof metric.value === "boolean") {
      point.floatField("value", metric.value ? 1 : 0);
      point.booleanField("value_bool", metric.value);
    } else if (typeof metric.value === "string") {
      point.stringField("value_text", metric.value);
    }

    if (typeof payload.seq === "number" && Number.isInteger(payload.seq)) {
      point.intField("seq", payload.seq);
    }

    if (ts && !Number.isNaN(ts.getTime())) point.timestamp(ts);
    writeApi.writePoint(point);
  }
}

function writeUnsPoint(topic: string, payloadBuf: Buffer): void {
  const uns = parseUnsTopic(topic);
  if (!uns) return;

  const payload = parsePayload(payloadBuf);
  if (!payload) return;

  const value = toNumber(payload.value);
  if (value === null) return;

  const unit = safeString(payload.unit);
  const status = isTelemetryStatus(payload.status) ? payload.status : safeString(payload.status);
  const seq = payload.seq;
  const ts = parseTs(payload.ts);

  const point = new Point(INFLUX_MEASUREMENT)
    .tag("enterprise", uns.enterprise)
    .tag("site", uns.site)
    .tag("area", uns.area)
    .tag("line", uns.line)
    .tag("cell", uns.cell)
    .tag("asset", uns.asset)
    .tag("class", uns.class)
    .tag("tag", uns.tag);

  if (unit) point.tag("unit", unit);
  if (status) point.tag("status", status);

  point.floatField("value", value);
  if (typeof seq === "number" && Number.isInteger(seq)) point.intField("seq", seq);
  if (ts) point.timestamp(ts);

  writeApi.writePoint(point);
}

const client = mqtt.connect(MQTT_URL, {
  clientId: process.env.MQTT_CLIENT_ID || `ingest-${Math.random().toString(16).slice(2)}`,
  clean: true
});

client.on("connect", () => {
  console.log(`Connected MQTT: ${MQTT_URL}, subscribing ${MQTT_SUB_TOPICS.join(", ")}`);
  client.subscribe(MQTT_SUB_TOPICS, { qos: 0 }, (err?: Error | null) => {
    if (err) console.error("MQTT subscribe error", err);
  });
});

client.on("message", (topic: string, payloadBuf: Buffer) => {
  if (topic.startsWith("spBv1.0/")) {
    writeSparkplugPoints(topic, payloadBuf);
    return;
  }

  writeUnsPoint(topic, payloadBuf);
});

process.on("SIGINT", async () => {
  try {
    await writeApi.close();
  } catch {
    // Ignore close failures during shutdown.
  }

  process.exit(0);
});
