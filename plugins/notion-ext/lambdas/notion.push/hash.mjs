// A value's fingerprint, the same wherever it is made: keys sorted, undefined left out — two copies of a block that say the same have
// the same fingerprint. (Copied into each lambda as hash.mjs: scripts/copy-lib.mjs.)

/** JSON with the keys of every object sorted. */
export function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
    .join(",")}}`;
}

/** 16 hex digits (two FNV-1a variants side by side) — no crypto needed, enough to tell blocks apart. */
export function hash(v) {
  const s = typeof v === "string" ? v : stable(v);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822507);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
