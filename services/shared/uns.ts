import { type UnsTopicSegments, type UnsTopicSuffix } from "./types.js";

export function parseUnsTopic(topic: string): UnsTopicSegments | null {
  const parts = topic.split("/").filter(Boolean);
  if (parts.length !== 10) return null;

  const root = parts[0];
  const version = parts[1];
  if (root !== "uns" || version !== "v1") return null;

  const [
    ,
    ,
    enterprise,
    site,
    area,
    line,
    cell,
    asset,
    klass,
    tag
  ] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string
  ];

  return { enterprise, site, area, line, cell, asset, class: klass, tag };
}

export function buildUnsTopic(prefix: string, suffix: UnsTopicSuffix): string {
  const base = prefix.replace(/\/+$/, "");
  return `${base}/${suffix.line}/${suffix.cell}/${suffix.asset}/${suffix.class}/${suffix.tag}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
