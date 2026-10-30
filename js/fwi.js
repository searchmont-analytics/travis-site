// Canadian Forest Fire Weather Index (FWI) System.
// Implements the daily equations from Van Wagner (1987), "Development and
// structure of the Canadian Forest Fire Weather Index System", Forestry
// Technical Report 35. Inputs are noon local standard time observations.

const FWI = (() => {
  // Effective day length for DMC and day length adjustment for DC, by month
  // (latitude ~46-65 N, which covers the Ontario fire region).
  const DMC_LE = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
  const DC_LF = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];

  // Standard spring start-up values.
  const STARTUP = { ffmc: 85, dmc: 6, dc: 15 };

  function ffmc(prev, temp, rh, wind, rain) {
    let mo = (147.2 * (101 - prev)) / (59.5 + prev);
    if (rain > 0.5) {
      const rf = rain - 0.5;
      let mr = mo + 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
      if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf);
      mo = Math.min(mr, 250);
    }
    const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10)
      + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
    let m;
    if (mo > ed) {
      const ko = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * Math.sqrt(wind) * (1 - (rh / 100) ** 8);
      const kd = ko * 0.581 * Math.exp(0.0365 * temp);
      m = ed + (mo - ed) * 10 ** -kd;
    } else {
      const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10)
        + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
      if (mo < ew) {
        const k1 = 0.424 * (1 - ((100 - rh) / 100) ** 1.7)
          + 0.0694 * Math.sqrt(wind) * (1 - ((100 - rh) / 100) ** 8);
        const kw = k1 * 0.581 * Math.exp(0.0365 * temp);
        m = ew - (ew - mo) * 10 ** -kw;
      } else {
        m = mo;
      }
    }
    return Math.min(Math.max((59.5 * (250 - m)) / (147.2 + m), 0), 101);
  }

  function dmc(prev, temp, rh, rain, month) {
    let po = prev;
    if (rain > 1.5) {
      const re = 0.92 * rain - 1.27;
      const mo = 20 + Math.exp(5.6348 - po / 43.43);
      let b;
      if (po <= 33) b = 100 / (0.5 + 0.3 * po);
      else if (po <= 65) b = 14 - 1.3 * Math.log(po);
      else b = 6.2 * Math.log(po) - 17.2;
      const mr = mo + (1000 * re) / (48.77 + b * re);
      po = Math.max(244.72 - 43.43 * Math.log(mr - 20), 0);
    }
    const t = Math.max(temp, -1.1);
    const k = 1.894 * (t + 1.1) * (100 - rh) * DMC_LE[month - 1] * 1e-6;
    return po + 100 * k;
  }

  function dc(prev, temp, rain, month) {
    let d0 = prev;
    if (rain > 2.8) {
      const rd = 0.83 * rain - 1.27;
      const qo = 800 * Math.exp(-d0 / 400);
      const qr = qo + 3.937 * rd;
      d0 = Math.max(400 * Math.log(800 / qr), 0);
    }
    const t = Math.max(temp, -2.8);
    const v = Math.max(0.36 * (t + 2.8) + DC_LF[month - 1], 0);
    return d0 + 0.5 * v;
  }

  function isi(ffmcVal, wind) {
    const fw = Math.exp(0.05039 * wind);
    const m = (147.2 * (101 - ffmcVal)) / (59.5 + ffmcVal);
    const ff = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7);
    return 0.208 * fw * ff;
  }

  function bui(p, d) {
    if (p === 0 && d === 0) return 0;
    const u = p <= 0.4 * d
      ? (0.8 * p * d) / (p + 0.4 * d)
      : p - (1 - (0.8 * d) / (p + 0.4 * d)) * (0.92 + (0.0114 * p) ** 1.7);
    return Math.max(u, 0);
  }

  function fwi(isiVal, buiVal) {
    const fd = buiVal <= 80
      ? 0.626 * buiVal ** 0.809 + 2
      : 1000 / (25 + 108.64 * Math.exp(-0.023 * buiVal));
    const b = 0.1 * isiVal * fd;
    return b > 1 ? Math.exp(2.72 * (0.434 * Math.log(b)) ** 0.647) : b;
  }

  // Run one day forward from yesterday's codes.
  function day(prev, obs) {
    const f = ffmc(prev.ffmc, obs.temp, obs.rh, obs.wind, obs.rain);
    const p = dmc(prev.dmc, obs.temp, obs.rh, obs.rain, obs.month);
    const d = dc(prev.dc, obs.temp, obs.rain, obs.month);
    const r = isi(f, obs.wind);
    const u = bui(p, d);
    return { ffmc: f, dmc: p, dc: d, isi: r, bui: u, fwi: fwi(r, u) };
  }

  // General FWI danger classes, used here for display only. Agencies set their
  // own class breaks by region and fuel type.
  const CLASSES = [
    { name: 'Low', max: 5, color: 'var(--c-low)' },
    { name: 'Moderate', max: 10, color: 'var(--c-mod)' },
    { name: 'High', max: 20, color: 'var(--c-high)' },
    { name: 'Very high', max: 30, color: 'var(--c-vhigh)' },
    { name: 'Extreme', max: Infinity, color: 'var(--c-ext)' },
  ];
  const dangerClass = (v) => CLASSES.find((c) => v < c.max);

  return { STARTUP, CLASSES, ffmc, dmc, dc, isi, bui, fwi, day, dangerClass };
})();
