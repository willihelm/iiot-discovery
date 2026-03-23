export function parseUnsTopic(topic) {
  // expected: uns/v1/<enterprise>/<site>/<area>/<line>/<cell>/<asset>/<class>/<tag>
  const parts = topic.split("/").filter(Boolean);
  if (parts.length < 10) return null;
  const [root, version, enterprise, site, area, line, cell, asset, klass, tag, ...rest] = parts;
  if (root !== "uns" || version !== "v1") return null;
  if (rest.length > 0) return null;
  return { enterprise, site, area, line, cell, asset, class: klass, tag };
}

export function buildUnsTopic(prefix, { line, cell, asset, class: klass, tag }) {
  const base = prefix.replace(/\/+$/, "");
  return `${base}/${line}/${cell}/${asset}/${klass}/${tag}`;
}

export function nowIso() {
  return new Date().toISOString();
}
