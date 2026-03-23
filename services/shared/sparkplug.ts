export const SparkplugDataType = {
  Unknown: 0,
  Int8: 1,
  Int16: 2,
  Int32: 3,
  Int64: 4,
  UInt8: 5,
  UInt16: 6,
  UInt32: 7,
  UInt64: 8,
  Float: 9,
  Double: 10,
  Boolean: 11,
  String: 12
} as const;

export type SparkplugScalarValue =
  | { kind: "uint64"; value: number | bigint }
  | { kind: "double"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string };

export interface SparkplugMetric {
  name?: string;
  alias?: number;
  timestamp?: number;
  datatype: number;
  value: SparkplugScalarValue;
}

export interface SparkplugPayload {
  timestamp: number;
  seq: number;
  metrics?: SparkplugMetric[];
}

export type SparkplugMessageType = "NBIRTH" | "NDEATH" | "DBIRTH" | "DDEATH" | "NDATA" | "DDATA";

export interface SparkplugTopicSegments {
  namespace: "spBv1.0";
  groupId: string;
  messageType: SparkplugMessageType;
  edgeNodeId: string;
  deviceId?: string;
}

export interface DecodedSparkplugMetric {
  name?: string;
  alias?: number;
  timestamp?: number;
  datatype?: number;
  value?: string | number | boolean | bigint;
}

export interface DecodedSparkplugPayload {
  timestamp?: number;
  seq?: number;
  metrics: DecodedSparkplugMetric[];
}

function encodeVarint(input: number | bigint): Buffer {
  let value = typeof input === "bigint" ? input : BigInt(input);
  if (value < 0n) {
    throw new Error("Sparkplug encoder only supports unsigned varints in this demo");
  }

  const bytes: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0n);

  return Buffer.from(bytes);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimited(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 2), encodeVarint(value.length), value]);
}

function encodeUint64(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), encodeVarint(value)]);
}

function encodeUint32(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), encodeVarint(value)]);
}

function encodeBoolean(fieldNumber: number, value: boolean): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), Buffer.from([value ? 1 : 0])]);
}

function encodeDouble(fieldNumber: number, value: number): Buffer {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleLE(value, 0);
  return Buffer.concat([encodeKey(fieldNumber, 1), bytes]);
}

function encodeString(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimited(fieldNumber, Buffer.from(value, "utf8"));
}

function encodeMetric(metric: SparkplugMetric): Buffer {
  const parts: Buffer[] = [];

  if (metric.name) parts.push(encodeString(1, metric.name));
  if (typeof metric.alias === "number") parts.push(encodeUint64(2, metric.alias));
  if (typeof metric.timestamp === "number") parts.push(encodeUint64(3, metric.timestamp));
  parts.push(encodeUint32(4, metric.datatype));

  if (metric.value.kind === "uint64") parts.push(encodeUint64(11, metric.value.value));
  if (metric.value.kind === "double") parts.push(encodeDouble(13, metric.value.value));
  if (metric.value.kind === "boolean") parts.push(encodeBoolean(14, metric.value.value));
  if (metric.value.kind === "string") parts.push(encodeString(15, metric.value.value));

  return Buffer.concat(parts);
}

export function encodeSparkplugPayload(payload: SparkplugPayload): Buffer {
  const parts: Buffer[] = [
    encodeUint64(1, payload.timestamp),
    encodeUint64(3, payload.seq)
  ];

  for (const metric of payload.metrics || []) {
    parts.push(encodeLengthDelimited(2, encodeMetric(metric)));
  }

  return Buffer.concat(parts);
}

export function buildSparkplugTopic(
  groupId: string,
  messageType: SparkplugMessageType,
  edgeNodeId: string,
  deviceId?: string
): string {
  const topic = `spBv1.0/${groupId}/${messageType}/${edgeNodeId}`;
  return deviceId ? `${topic}/${deviceId}` : topic;
}

export function parseSparkplugTopic(topic: string): SparkplugTopicSegments | null {
  const parts = topic.split("/").filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) return null;

  const namespace = parts[0];
  const groupId = parts[1];
  const messageType = parts[2];
  const edgeNodeId = parts[3];
  const deviceId = parts[4];
  if (namespace !== "spBv1.0") return null;
  if (!groupId || !edgeNodeId) return null;
  if (
    messageType !== "NBIRTH" &&
    messageType !== "NDEATH" &&
    messageType !== "DBIRTH" &&
    messageType !== "DDEATH" &&
    messageType !== "NDATA" &&
    messageType !== "DDATA"
  ) {
    return null;
  }

  const segments: SparkplugTopicSegments = {
    namespace,
    groupId,
    messageType,
    edgeNodeId
  };

  if (deviceId) segments.deviceId = deviceId;

  return segments;
}

function readVarint(buffer: Buffer, offset: number): { value: bigint; offset: number } {
  let result = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length) {
    const nextByte = buffer[index];
    if (typeof nextByte !== "number") break;

    const byte = BigInt(nextByte);
    result |= (byte & 0x7fn) << shift;
    index += 1;

    if ((byte & 0x80n) === 0n) {
      return { value: result, offset: index };
    }

    shift += 7n;
  }

  throw new Error("Unexpected end of Sparkplug payload while reading varint");
}

function toSafeNumber(value: bigint): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Sparkplug integer value exceeds Number safe range");
  }

  return asNumber;
}

function readLengthDelimited(buffer: Buffer, offset: number): { value: Buffer; offset: number } {
  const lengthResult = readVarint(buffer, offset);
  const length = toSafeNumber(lengthResult.value);
  const end = lengthResult.offset + length;
  if (end > buffer.length) {
    throw new Error("Unexpected end of Sparkplug payload while reading length-delimited field");
  }

  return {
    value: buffer.subarray(lengthResult.offset, end),
    offset: end
  };
}

function skipUnknownField(buffer: Buffer, offset: number, wireType: number): number {
  if (wireType === 0) {
    return readVarint(buffer, offset).offset;
  }

  if (wireType === 1) {
    return offset + 8;
  }

  if (wireType === 2) {
    return readLengthDelimited(buffer, offset).offset;
  }

  if (wireType === 5) {
    return offset + 4;
  }

  throw new Error(`Unsupported Sparkplug wire type: ${wireType}`);
}

function decodeMetric(buffer: Buffer): DecodedSparkplugMetric {
  const metric: DecodedSparkplugMetric = {};
  let offset = 0;

  while (offset < buffer.length) {
    const keyResult = readVarint(buffer, offset);
    const key = toSafeNumber(keyResult.value);
    offset = keyResult.offset;

    const fieldNumber = key >> 3;
    const wireType = key & 0x07;

    if (fieldNumber === 1 && wireType === 2) {
      const result = readLengthDelimited(buffer, offset);
      metric.name = result.value.toString("utf8");
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 2 && wireType === 0) {
      const result = readVarint(buffer, offset);
      metric.alias = toSafeNumber(result.value);
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 3 && wireType === 0) {
      const result = readVarint(buffer, offset);
      metric.timestamp = toSafeNumber(result.value);
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 4 && wireType === 0) {
      const result = readVarint(buffer, offset);
      metric.datatype = toSafeNumber(result.value);
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 11 && wireType === 0) {
      const result = readVarint(buffer, offset);
      metric.value = result.value;
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 13 && wireType === 1) {
      if (offset + 8 > buffer.length) {
        throw new Error("Unexpected end of Sparkplug payload while reading double");
      }

      metric.value = buffer.readDoubleLE(offset);
      offset += 8;
      continue;
    }

    if (fieldNumber === 14 && wireType === 0) {
      const result = readVarint(buffer, offset);
      metric.value = result.value !== 0n;
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 15 && wireType === 2) {
      const result = readLengthDelimited(buffer, offset);
      metric.value = result.value.toString("utf8");
      offset = result.offset;
      continue;
    }

    offset = skipUnknownField(buffer, offset, wireType);
  }

  return metric;
}

export function decodeSparkplugPayload(buffer: Buffer): DecodedSparkplugPayload {
  const payload: DecodedSparkplugPayload = { metrics: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const keyResult = readVarint(buffer, offset);
    const key = toSafeNumber(keyResult.value);
    offset = keyResult.offset;

    const fieldNumber = key >> 3;
    const wireType = key & 0x07;

    if (fieldNumber === 1 && wireType === 0) {
      const result = readVarint(buffer, offset);
      payload.timestamp = toSafeNumber(result.value);
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 2 && wireType === 2) {
      const result = readLengthDelimited(buffer, offset);
      payload.metrics.push(decodeMetric(result.value));
      offset = result.offset;
      continue;
    }

    if (fieldNumber === 3 && wireType === 0) {
      const result = readVarint(buffer, offset);
      payload.seq = toSafeNumber(result.value);
      offset = result.offset;
      continue;
    }

    offset = skipUnknownField(buffer, offset, wireType);
  }

  return payload;
}
