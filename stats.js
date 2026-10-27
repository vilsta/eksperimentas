// Statistiniai testai rezultatų analizei (be išorinių bibliotekų).

// ln Γ(x), Lanczos aproksimacija.
const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Reguliarizuota viršutinė nepilnoji gama funkcija Q(a, x).
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, term = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap += 1; term *= x / ap; sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-15) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h);
}

export const chi2Sf = (x, df) => (x <= 0 ? 1 : gammaQ(df / 2, x / 2));
// Dvipusė normaliojo skirstinio p reikšmė: P(|Z| > |z|).
export const normalTwoSided = z => gammaQ(0.5, (z * z) / 2);

export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = xs => quantile(xs, 0.5);

const sum = xs => xs.reduce((a, b) => a + b, 0);
const rowSums = t => t.map(sum);
const colSums = t => t[0].map((_, j) => sum(t.map(r => r[j])));

export function cramersV(chi2, n, rows, cols) {
  const k = Math.min(rows, cols) - 1;
  return n > 0 && k > 0 ? Math.sqrt(chi2 / (n * k)) : null;
}

// Pirsono χ² priklausomybės testas dažnių lentelei (be Yates pataisos).
export function chiSquare(table) {
  const r = rowSums(table), c = colSums(table), n = sum(r);
  const expected = table.map((row, i) => row.map((_, j) => (r[i] * c[j]) / n));
  let chi2 = 0;
  table.forEach((row, i) => row.forEach((o, j) => { const e = expected[i][j]; if (e > 0) chi2 += ((o - e) ** 2) / e; }));
  const df = (table.length - 1) * (table[0].length - 1);
  const residuals = table.map((row, i) => row.map((o, j) => {
    const e = expected[i][j], v = e * (1 - r[i] / n) * (1 - c[j] / n);
    return v > 0 ? (o - e) / Math.sqrt(v) : 0;
  }));
  const flat = expected.flat();
  return {
    chi2, df, n, p: chi2Sf(chi2, df), expected, residuals,
    v: cramersV(chi2, n, table.length, table[0].length),
    minExpected: Math.min(...flat),
    lowExpectedShare: flat.filter(e => e < 5).length / flat.length
  };
}

// Fišerio tikslusis testas 2×2 lentelei (dvipusis).
export function fisherExact(table) {
  const [[a, b], [c, d]] = table, r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lf = k => lnGamma(k + 1);
  const logP = x => lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x);
  const observed = logP(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

// Mann–Whitney U testas (normalioji aproksimacija su ryšių ir tolydumo pataisomis).
export function mannWhitney(x, y) {
  const n1 = x.length, n2 = y.length, N = n1 + n2;
  if (!n1 || !n2) return null;
  const all = [...x.map(v => [v, 0]), ...y.map(v => [v, 1])].sort((a, b) => a[0] - b[0]);
  const ranks = new Array(N);
  let tieTerm = 0;
  for (let i = 0; i < N;) {
    let j = i;
    while (j + 1 < N && all[j + 1][0] === all[i][0]) j++;
    const rank = (i + j + 2) / 2, t = j - i + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  const r1 = sum(all.map((v, i) => (v[1] === 0 ? ranks[i] : 0)));
  const u1 = r1 - (n1 * (n1 + 1)) / 2, mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1))));
  if (!(sigma > 0)) return { u: u1, z: 0, p: 1, r: 0, n1, n2 };
  const diff = u1 - mu, z = (diff - Math.sign(diff) * Math.min(0.5, Math.abs(diff))) / sigma;
  return { u: u1, z, p: normalTwoSided(z), r: Math.abs(z) / Math.sqrt(N), n1, n2 };
}

function invert(m) {
  const n = m.length, a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map(row => row.slice(n));
}

// Cochrano–Mantelio–Haenszelio bendrosios priklausomybės testas (I×J×K).
// strata – vienodo dydžio dažnių lentelės, po vieną kiekvienam kontrolinio kintamojo lygiui.
export function cmh(strata) {
  const used = strata.filter(t => sum(rowSums(t)) >= 2);
  if (!used.length) return null;
  const I = used[0].length, J = used[0][0].length, dim = (I - 1) * (J - 1);
  const idx = []; for (let i = 0; i < I - 1; i++) for (let j = 0; j < J - 1; j++) idx.push([i, j]);
  const diff = new Array(dim).fill(0), cov = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (const t of used) {
    const r = rowSums(t), c = colSums(t), n = sum(r);
    idx.forEach(([i, j], a) => {
      diff[a] += t[i][j] - (r[i] * c[j]) / n;
      idx.forEach(([k, l], b) => {
        cov[a][b] += (r[i] * ((i === k ? n : 0) - r[k]) * c[j] * ((j === l ? n : 0) - c[l])) / (n * n * (n - 1));
      });
    });
  }
  const inv = invert(cov);
  if (!inv) return null;
  let q = 0;
  for (let a = 0; a < dim; a++) for (let b = 0; b < dim; b++) q += diff[a] * inv[a][b] * diff[b];
  return { stat: q, df: dim, p: chi2Sf(q, dim), strata: used.length };
}

// Holmo–Bonferronio korekcija.
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), m = ps.length, out = new Array(m);
  let running = 0;
  order.forEach(([p, i], k) => { running = Math.max(running, Math.min(1, (m - k) * p)); out[i] = running; });
  return out;
}
