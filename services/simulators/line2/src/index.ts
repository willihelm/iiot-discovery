import mqtt from "mqtt";
import { type AssetDefinition, type TelemetryPayload } from "../../../shared/types.js";
import { buildUnsTopic, nowIso } from "../../../shared/uns.js";

const MQTT_URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "uns/v1/acme/berlin/packaging";
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || 1000);

const LINE = "line-02";
const CELL = "cell-01";

const assets: AssetDefinition[] = [
  {
    asset: "conveyor-01",
    points: [
      { class: "motor", tag: "speed_rpm", unit: "rpm" },
      { class: "sensor", tag: "vibration_mm_s", unit: "mm/s" },
      { class: "state", tag: "running", unit: "bool" }
    ]
  },
  {
    asset: "packer-01",
    points: [
      { class: "sensor", tag: "temperature", unit: "C" },
      { class: "motor", tag: "speed_rpm", unit: "rpm" },
      { class: "counter", tag: "produced_count", unit: "pcs" },
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
const counters = new Map<string, number>();

function noise(scale: number): number {
  return (Math.random() - 0.5) * scale;
}

function maybeBad(): "GOOD" | "BAD" {
  return Math.random() < 0.015 ? "BAD" : "GOOD";
}

function getCounter(key: string, increment: number): number {
  const nextValue = (counters.get(key) || 0) + increment;
  counters.set(key, nextValue);
  return nextValue;
}

function valueFor(tag: string, tSec: number, running: boolean): number | null {
  if (tag === "running") return running ? 1 : 0;
  if (tag === "temperature") return 42 + Math.sin(tSec / 28) * 2.5 + noise(0.5);
  if (tag === "speed_rpm") return running ? 1200 + Math.sin(tSec / 12) * 50 + noise(10) : 0;
  if (tag === "reject_rate") return Math.max(0, 0.8 + Math.sin(tSec / 60) * 0.25 + noise(0.15));
  if (tag === "vibration_mm_s") return running ? Math.max(0, 3 + Math.sin(tSec / 8) * 0.7 + noise(0.4)) : 0;
  return null;
}

function publishTick(): void {
  const tSec = Date.now() / 1000;
  const running = Math.floor(tSec) % 210 < 190;

  for (const assetDefinition of assets) {
    for (const pointDefinition of assetDefinition.points) {
      const topic = buildUnsTopic(MQTT_TOPIC_PREFIX, {
        line: LINE,
        cell: CELL,
        asset: assetDefinition.asset,
        class: pointDefinition.class,
        tag: pointDefinition.tag
      });

      let value = valueFor(pointDefinition.tag, tSec, running);
      if (pointDefinition.tag === "produced_count") {
        const key = `${assetDefinition.asset}/produced_count`;
        const increment = running ? Math.max(0, Math.round(3 + noise(1.5))) : 0;
        value = getCounter(key, increment);
      }

      if (value === null) continue;

      seq += 1;
      const payload: TelemetryPayload = {
        ts: nowIso(),
        value,
        unit: pointDefinition.unit,
        status: running ? maybeBad() : "UNCERTAIN",
        seq
      };

      client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false });
    }
  }
}

client.on("connect", () => {
  console.log(`Connected MQTT: ${MQTT_URL} (sim ${LINE}), publishing every ${PUBLISH_INTERVAL_MS}ms`);
  setInterval(publishTick, PUBLISH_INTERVAL_MS);
});
