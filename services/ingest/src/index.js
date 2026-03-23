import mqtt from "mqtt";
import { InfluxDB, Point } from "@influxdata/influxdb-client";
import { parseUnsTopic } from "../shared/uns.js";

const MQTT_URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "uns/v1/acme/berlin/packaging";
const MQTT_SUB_TOPIC = `${MQTT_TOPIC_PREFIX}/#`;

const INFLUX_URL = process.env.INFLUX_URL || "http://influxdb:8086";
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || "";
const INFLUX_ORG = process.env.INFLUX_ORG || process.env.INFLUXDB_ORG || "acme";
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || process.env.INFLUXDB_BUCKET || "iiot";
const INFLUX_MEASUREMENT = process.env.INFLUX_MEASUREMENT || "telemetry";

if (!INFLUX_TOKEN) {
  // fail fast; without token we can't write anything
  // eslint-disable-next-line no-console
  console.error("Missing INFLUX_TOKEN");
  process.exit(1);
}

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, "ms");
writeApi.useDefaultTags({ source: "mqtt-ingest" });

function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function safeString(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

const client = mqtt.connect(MQTT_URL, {
  clientId: process.env.MQTT_CLIENT_ID || `ingest-${Math.random().toString(16).slice(2)}`,
  clean: true
});

client.on("connect", () => {
  // eslint-disable-next-line no-console
  console.log(`Connected MQTT: ${MQTT_URL}, subscribing ${MQTT_SUB_TOPIC}`);
  client.subscribe(MQTT_SUB_TOPIC, { qos: 0 }, (err) => {
    if (err) console.error("MQTT subscribe error", err);
  });
});

client.on("message", (topic, payloadBuf) => {
  const uns = parseUnsTopic(topic);
  if (!uns) return;

  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return;
  }

  const value = toNumber(payload?.value);
  if (value === null) return;

  const unit = safeString(payload?.unit);
  const status = safeString(payload?.status);
  const seq = payload?.seq;
  const ts = parseTs(payload?.ts);

  const p = new Point(INFLUX_MEASUREMENT)
    .tag("enterprise", uns.enterprise)
    .tag("site", uns.site)
    .tag("area", uns.area)
    .tag("line", uns.line)
    .tag("cell", uns.cell)
    .tag("asset", uns.asset)
    .tag("class", uns.class)
    .tag("tag", uns.tag);

  if (unit) p.tag("unit", unit);
  if (status) p.tag("status", status);

  p.floatField("value", value);
  if (Number.isInteger(seq)) p.intField("seq", seq);

  if (ts) p.timestamp(ts);

  writeApi.writePoint(p);
});

process.on("SIGINT", async () => {
  try {
    await writeApi.close();
  } catch {
    // ignore
  }
  process.exit(0);
});

