# IIoT UNS Simulation (MQTT → InfluxDB → Grafana)

This project starts a small, modern, **simulated IIoT infrastructure** via Docker Compose:

- **MQTT Broker**: Eclipse Mosquitto
- **Time-Series DB**: InfluxDB 2
- **Visualization**: Grafana (provisioned)
- **NodeJS Services**:
- `ingest`: subscribes to UNS-MQTT topics and writes to InfluxDB
  - also decodes the repo's Sparkplug B example into a separate Influx measurement
  - `sim-line1`, `sim-line2`: send example values like from a production line
  - `sim-sparkplug`: publishes a small Sparkplug B example (`NBIRTH`/`DBIRTH`/`DDATA`)

The services are written in TypeScript and compiled to JavaScript before Node runs them in Docker.

## Quickstart

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Start:

```bash
docker compose up -d --build
```

3. Open:
- **Grafana**: `http://localhost:${GRAFANA_PORT:-3000}` (Default: `admin` / `admin`)
- **InfluxDB UI**: `http://localhost:${INFLUX_PORT:-8086}`

## UNS (Unified Namespace)

### MQTT Topic Convention

Root:

`uns/v1/<enterprise>/<site>/<area>/<line>/<cell>/<asset>/<class>/<tag>`

Examples:
- `uns/v1/acme/berlin/packaging/line-01/cell-01/filler-01/sensor/temperature`
- `uns/v1/acme/berlin/packaging/line-01/cell-01/filler-01/motor/speed_rpm`
- `uns/v1/acme/berlin/packaging/line-01/cell-01/checkweigher-01/quality/reject_rate`

### Payload Contract (JSON)

```json
{
  "ts": "2026-03-17T12:34:56.789Z",
  "value": 42.1,
  "unit": "C",
  "status": "GOOD",
  "seq": 12345
}
```

- `ts`: ISO-8601 timestamp (optional; if missing: ingest time)
- `value`: measurement value (Number)
- `unit`: unit (String, optional)
- `status`: e.g. `GOOD|BAD|UNCERTAIN` (optional)
- `seq`: sequence number (optional)

## InfluxDB Data Model

Measurement: `telemetry`

- **Tags**: `enterprise, site, area, line, cell, asset, class, tag, unit, status`
- **Fields**: `value` (float), optional `seq` (int)
- **Timestamp**: from `ts` (if parseable), otherwise ingest time

## Services

- `services/ingest`: MQTT subscribe `uns/v1/#` → Topic-Parsing → Influx write
- `services/simulators/line1`: simulates `line-01` (multiple assets/tags)
- `services/simulators/line2`: simulates `line-02` (multiple assets/tags)
- `services/simulators/sparkplug`: publishes a Sparkplug B edge node + device example

## Sparkplug B Example

This repo now also includes a small **Sparkplug B example flow**. The simulator publishes Sparkplug topics with binary Protobuf payloads and sends:

- `NBIRTH` for the edge node
- `DBIRTH` for one example device
- recurring `DDATA` telemetry updates
- `DDEATH` during graceful shutdown
- `NDEATH` as the MQTT last will

Example topics:

- `spBv1.0/acme-packaging/NBIRTH/line-01-edge`
- `spBv1.0/acme-packaging/DBIRTH/line-01-edge/filler-01`
- `spBv1.0/acme-packaging/DDATA/line-01-edge/filler-01`

Environment variables for the example service:

- `SPARKPLUG_GROUP_ID` (default: `acme-packaging`)
- `SPARKPLUG_EDGE_NODE_ID` (default: `line-01-edge`)
- `SPARKPLUG_DEVICE_ID` (default: `filler-01`)
- `PUBLISH_INTERVAL_MS` (default: `1000`)

The existing `ingest` service still handles the repo's **UNS JSON** format on `uns/v1/...`, and it now also subscribes to `spBv1.0/#`. For the Sparkplug path it decodes the subset used by this repo's example (`UInt64`, `Double`, `Boolean`, `String`) into the Influx measurement `sparkplug_telemetry`.

The Grafana dashboard includes a new panel, **Sparkplug Device Metrics**, which graphs the numeric `DDATA` metrics for the demo device `filler-01`.

## UNS in Code

The topic convention is mapped centrally in `services/shared/uns.ts`:
- `parseUnsTopic(topic)`: Topic → UNS segments (enterprise/site/area/line/…)
- `buildUnsTopic(prefix, segments)`: Prefix + segments → Topic string

## TypeScript Notes

- Node.js is still the runtime for all services.
- TypeScript adds static checking plus a build step with `tsc`.
- Source files live in `src/*.ts` and the compiled JavaScript lands in `dist/`.
- This repo keeps ESM mode (`"type": "module"`), so TypeScript imports use `.js` in import paths because those paths must match the emitted runtime files.

## Troubleshooting

- **No data in Grafana**: In Grafana, check the time range in the top-right (e.g. "Last 15 minutes"). Then check the InfluxDB UI to confirm points arrive in the bucket.
- **Reset (delete everything)**:

```bash
docker compose down -v
```
