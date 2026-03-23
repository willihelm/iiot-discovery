import mqtt from "mqtt";
import {
  SparkplugDataType,
  buildSparkplugTopic,
  encodeSparkplugPayload,
  type SparkplugMetric
} from "../../../shared/sparkplug.js";

const MQTT_URL = process.env.MQTT_URL || "mqtt://mosquitto:1883";
const GROUP_ID = process.env.SPARKPLUG_GROUP_ID || "acme-packaging";
const EDGE_NODE_ID = process.env.SPARKPLUG_EDGE_NODE_ID || "line-01-edge";
const DEVICE_ID = process.env.SPARKPLUG_DEVICE_ID || "filler-01";
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || 1000);

const deviceMetricAliases = {
  temperature: 1,
  speedRpm: 2,
  running: 3,
  producedCount: 4
} as const;

let birthSequence = 0;
let sequence = 0;
let producedCount = 0n;
let intervalHandle: NodeJS.Timeout | null = null;

function timestamp(): number {
  return Date.now();
}

function nextSequence(): number {
  const current = sequence;
  sequence = (sequence + 1) % 256;
  return current;
}

function noise(scale: number): number {
  return (Math.random() - 0.5) * scale;
}

function createBdSeqMetric(value: number): SparkplugMetric {
  return {
    name: "bdSeq",
    datatype: SparkplugDataType.UInt64,
    value: { kind: "uint64", value }
  };
}

function publishMessage(
  client: mqtt.MqttClient,
  messageType: "NBIRTH" | "NDEATH" | "DBIRTH" | "DDEATH" | "DDATA",
  metrics: SparkplugMetric[],
  deviceId?: string
): void {
  const payload = encodeSparkplugPayload({
    timestamp: timestamp(),
    seq: nextSequence(),
    metrics
  });

  client.publish(buildSparkplugTopic(GROUP_ID, messageType, EDGE_NODE_ID, deviceId), payload, {
    qos: 0,
    retain: false
  });
}

function nodeBirthMetrics(): SparkplugMetric[] {
  return [
    createBdSeqMetric(birthSequence),
    {
      name: "Node Control/Rebirth",
      datatype: SparkplugDataType.Boolean,
      value: { kind: "boolean", value: false }
    },
    {
      name: "Node Info/Status",
      datatype: SparkplugDataType.String,
      value: { kind: "string", value: "ONLINE" }
    }
  ];
}

function deviceBirthMetrics(now: number, running: boolean): SparkplugMetric[] {
  return [
    {
      name: "Process/Temperature",
      alias: deviceMetricAliases.temperature,
      timestamp: now,
      datatype: SparkplugDataType.Double,
      value: { kind: "double", value: 38.4 }
    },
    {
      name: "Motor/SpeedRPM",
      alias: deviceMetricAliases.speedRpm,
      timestamp: now,
      datatype: SparkplugDataType.Double,
      value: { kind: "double", value: 1450 }
    },
    {
      name: "State/Running",
      alias: deviceMetricAliases.running,
      timestamp: now,
      datatype: SparkplugDataType.Boolean,
      value: { kind: "boolean", value: running }
    },
    {
      name: "Counter/ProducedCount",
      alias: deviceMetricAliases.producedCount,
      timestamp: now,
      datatype: SparkplugDataType.UInt64,
      value: { kind: "uint64", value: producedCount }
    }
  ];
}

function deviceDataMetrics(now: number, running: boolean): SparkplugMetric[] {
  const tSec = now / 1000;
  const temperature = 38 + Math.sin(tSec / 30) * 2 + noise(0.4);
  const speedRpm = running ? 1450 + Math.sin(tSec / 10) * 35 + noise(8) : 0;
  producedCount += BigInt(running ? Math.max(0, Math.round(2 + noise(1))) : 0);

  return [
    {
      alias: deviceMetricAliases.temperature,
      timestamp: now,
      datatype: SparkplugDataType.Double,
      value: { kind: "double", value: temperature }
    },
    {
      alias: deviceMetricAliases.speedRpm,
      timestamp: now,
      datatype: SparkplugDataType.Double,
      value: { kind: "double", value: speedRpm }
    },
    {
      alias: deviceMetricAliases.running,
      timestamp: now,
      datatype: SparkplugDataType.Boolean,
      value: { kind: "boolean", value: running }
    },
    {
      alias: deviceMetricAliases.producedCount,
      timestamp: now,
      datatype: SparkplugDataType.UInt64,
      value: { kind: "uint64", value: producedCount }
    }
  ];
}

const deathPayload = encodeSparkplugPayload({
  timestamp: timestamp(),
  seq: 0,
  metrics: [createBdSeqMetric(birthSequence)]
});

const client = mqtt.connect(MQTT_URL, {
  clientId: process.env.MQTT_CLIENT_ID || `sparkplug-${EDGE_NODE_ID}-${Math.random().toString(16).slice(2)}`,
  clean: true,
  will: {
    topic: buildSparkplugTopic(GROUP_ID, "NDEATH", EDGE_NODE_ID),
    payload: deathPayload,
    qos: 0,
    retain: false
  }
});

client.on("connect", () => {
  const now = timestamp();
  const running = true;

  console.log(
    `Connected MQTT: ${MQTT_URL} (Sparkplug B ${GROUP_ID}/${EDGE_NODE_ID}/${DEVICE_ID}), publishing every ${PUBLISH_INTERVAL_MS}ms`
  );

  publishMessage(client, "NBIRTH", nodeBirthMetrics());
  publishMessage(client, "DBIRTH", deviceBirthMetrics(now, running), DEVICE_ID);

  intervalHandle = setInterval(() => {
    const currentTs = timestamp();
    const isRunning = Math.floor(currentTs / 1000) % 180 < 165;
    publishMessage(client, "DDATA", deviceDataMetrics(currentTs, isRunning), DEVICE_ID);
  }, PUBLISH_INTERVAL_MS);
});

async function shutdown(): Promise<void> {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  if (client.connected) {
    publishMessage(client, "DDEATH", [], DEVICE_ID);
    publishMessage(client, "NDEATH", [createBdSeqMetric(birthSequence)]);
  }

  client.end(true);
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
