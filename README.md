# IIoT UNS Simulation (MQTT → InfluxDB → Grafana)

This project starts a small, modern, **simulated IIoT infrastructure** via Docker Compose:

- **MQTT Broker**: Eclipse Mosquitto
- **Time-Series DB**: InfluxDB 2
- **Visualization**: Grafana (provisioned)
- **NodeJS Services**:
  - `ingest`: subscribes to UNS-MQTT topics and writes to InfluxDB
  - `sim-line1`, `sim-line2`: send example values like from a production line

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

## UNS in Code

The topic convention is mapped centrally in `services/shared/uns.js`:
- `parseUnsTopic(topic)`: Topic → UNS segments (enterprise/site/area/line/…)
- `buildUnsTopic(prefix, segments)`: Prefix + segments → Topic string

## Troubleshooting

- **No data in Grafana**: In Grafana, check the time range in the top-right (e.g. "Last 15 minutes"). Then check the InfluxDB UI to confirm points arrive in the bucket.
- **Reset (delete everything)**:

```bash
docker compose down -v
```
