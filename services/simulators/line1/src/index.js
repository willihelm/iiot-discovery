import mqtt from "mqtt";
import { buildUnsTopic, nowIso } from "../shared/uns.js";

const MQTT_URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "uns/v1/acme/berlin/packaging";
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || 1000);

const LINE = "line-01";
const CELL = "cell-01";

const assets = [
  {
    asset: "filler-01",
    points: [
      { class: "sensor", tag: "temperature", unit: "C" },
      { class: "motor", tag: "speed_rpm", unit: "rpm" },
      { class: "state", tag: "running", unit: "bool" },
      { class: "counter", tag: "produced_count", unit: "pcs" }
    ]
  },
  {
    asset: "labeler-01",
    points: [
      { class: "motor", tag: "speed_rpm", unit: "rpm" },
      { class: "quality", tag: "reject_rate", unit: "%" },
      { class: "state", tag: "running", unit: "bool" },
      { class: "counter", tag: "produced_count", unit: "pcs" }
    ]
  },
  {
    asset: "checkweigher-01",
    points: [
      { class: "sensor", tag: "weight_g", unit: "g" },
      { class: "quality", tag: "reject_rate", unit: "%" },
      { class: "state", tag: "running", unit: "bool" }
    ]
  }
];

const client = mqtt.connect(MQTT_URL, {
  clientId: process.env.MQTT_CLIENT_ID || `sim-${LINE}-${Math.random().toString(16).slice(2)}`,
  clean: true
});

let seq = 0;
const counters = new Map(); // key -> number

function noise(scale) {
  return (Math.random() - 0.5) * scale;
}

function maybeBad() {
  return Math.random() < 0.01 ? "BAD" : "GOOD";
}

function getCounter(key, inc) {
  const v = (counters.get(key) || 0) + inc;
  counters.set(key, v);
  return v;
}

function valueFor(point, tSec, running) {
  if (point.tag === "running") return running ? 1 : 0;

  if (point.tag === "temperature") {
    return 38 + Math.sin(tSec / 30) * 2 + noise(0.4);
  }

  if (point.tag === "speed_rpm") {
    return running ? 1450 + Math.sin(tSec / 10) * 35 + noise(8) : 0;
  }

  if (point.tag === "reject_rate") {
    return Math.max(0, 0.6 + Math.sin(tSec / 45) * 0.2 + noise(0.1));
  }

  if (point.tag === "weight_g") {
    return 500 + Math.sin(tSec / 20) * 8 + noise(3);
  }

  if (point.tag === "produced_count") {
    if (!running) return getCounter("hold", 0);
    return null; // handled separately; needs per-asset counter
  }

  return null;
}

function publishTick() {
  const tSec = Date.now() / 1000;

  // synthetic downtime windows
  const running = Math.floor(tSec) % 180 < 165;

  for (const a of assets) {
    for (const p of a.points) {
      const topic = buildUnsTopic(MQTT_TOPIC_PREFIX, {
        line: LINE,
        cell: CELL,
        asset: a.asset,
        class: p.class,
        tag: p.tag
      });

      let value = valueFor(p, tSec, running);
      if (p.tag === "produced_count") {
        const key = `${a.asset}/produced_count`;
        const inc = running ? Math.max(0, Math.round(2 + noise(1))) : 0;
        value = getCounter(key, inc);
      }

      if (value === null) continue;

      seq += 1;
      const payload = JSON.stringify({
        ts: nowIso(),
        value,
        unit: p.unit,
        status: running ? maybeBad() : "UNCERTAIN",
        seq
      });

      client.publish(topic, payload, { qos: 0, retain: false });
    }
  }
}

client.on("connect", () => {
  // eslint-disable-next-line no-console
  console.log(`Connected MQTT: ${MQTT_URL} (sim ${LINE}), publishing every ${PUBLISH_INTERVAL_MS}ms`);
  setInterval(publishTick, PUBLISH_INTERVAL_MS);
});

