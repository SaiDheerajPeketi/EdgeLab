export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function requireNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new Error(`${field} is required and must be numeric.`);
    error.status = 400;
    throw error;
  }
  return number;
}

export function asOptionalText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
