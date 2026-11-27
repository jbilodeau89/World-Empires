// Lengths are stored internally in inches. These helpers format and parse them.
export const IN_PER_M = 39.37007874015748;

export function formatLen(inches, units) {
  if (!isFinite(inches)) return '';
  const neg = inches < 0;
  const v = Math.abs(inches);
  if (units === 'metric') {
    const m = v / IN_PER_M;
    return (neg ? '-' : '') + (m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`);
  }
  const total = Math.round(v * 2) / 2; // nearest half inch
  let ft = Math.floor(total / 12);
  let inch = total - ft * 12;
  const whole = Math.floor(inch);
  const half = inch - whole >= 0.5;
  const inStr = `${whole}${half ? '½' : ''}"`;
  let s;
  if (ft === 0) s = inStr;
  else if (inch === 0) s = `${ft}'`;
  else s = `${ft}' ${inStr}`;
  return (neg ? '-' : '') + s;
}

/** Plain-text version for input boxes (no ½ glyph). */
export function formatLenInput(inches, units) {
  if (units === 'metric') {
    const m = inches / IN_PER_M;
    if (Math.abs(m) < 1) return (m * 100).toFixed(1).replace(/\.0$/, '') + ' cm';
    return m.toFixed(3).replace(/\.?0+$/, '') + ' m';
  }
  const total = Math.round(inches * 4) / 4;
  const ft = Math.floor(total / 12);
  const inch = +(total - ft * 12).toFixed(2);
  if (ft === 0) return `${inch}"`;
  if (inch === 0) return `${ft}'`;
  return `${ft}' ${inch}"`;
}

export function formatArea(sqIn, units) {
  if (units === 'metric') return `${(sqIn / (IN_PER_M * IN_PER_M)).toFixed(2)} m²`;
  return `${(sqIn / 144).toFixed(1)} sq ft`;
}

function num(s) {
  if (s == null || s === '') return 0;
  s = s.trim();
  const frac = s.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/);
  if (!frac) return NaN;
  let v = frac[1] ? parseFloat(frac[1]) : 0;
  if (frac[2]) v += parseInt(frac[2], 10) / parseInt(frac[3], 10);
  return v;
}

/**
 * Parse a length typed by the user. Returns inches, or null if it can't be read.
 * Accepts: 12'6"  12' 6  12ft 6in  12-6  12 6  6"  6 1/2"  12.5'  3.5m  350cm  3500mm
 * A bare number means feet (imperial) or metres (metric).
 */
export function parseLen(input, units) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase()
    .replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"')
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4')
    .replace(/\s+/g, ' ');
  if (!s) return null;

  let m = s.match(/^(\d*\.?\d+)\s*(mm|cm|m|meters?|metres?)$/);
  if (m) {
    const v = parseFloat(m[1]);
    const unit = m[2];
    if (unit === 'mm') return v / 1000 * IN_PER_M;
    if (unit === 'cm') return v / 100 * IN_PER_M;
    return v * IN_PER_M;
  }

  // feet + inches with explicit marks
  m = s.match(/^(?:(\d*\.?\d+)\s*(?:'|ft|feet|foot))?\s*-?\s*(?:((?:\d*\.?\d+)?(?:\s*\d+\/\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (m && (m[1] || m[2])) {
    const hasFtMark = m[1] != null;
    const hasInMark = /("|in)/.test(s);
    if (hasFtMark || hasInMark) {
      const ft = m[1] ? parseFloat(m[1]) : 0;
      const inch = m[2] ? num(m[2]) : 0;
      if (isNaN(inch)) return null;
      return ft * 12 + inch;
    }
  }

  // "12 6" or "12-6" => feet inches (imperial only)
  m = s.match(/^(\d+)\s*[- ]\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)$/);
  if (m && units !== 'metric') {
    const inch = num(m[2]);
    if (!isNaN(inch)) return parseInt(m[1], 10) * 12 + inch;
  }

  m = s.match(/^\d*\.?\d+$/);
  if (m) {
    const v = parseFloat(s);
    return units === 'metric' ? v * IN_PER_M : v * 12;
  }
  return null;
}

/** Grid levels, finest to coarsest, in inches. */
export function gridLevels(units) {
  if (units === 'metric') return [1, 5, 10, 50, 100, 500, 1000].map(cm => cm / 100 * IN_PER_M);
  return [1, 6, 12, 60, 120, 600];
}
