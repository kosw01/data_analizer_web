"use strict";

/* 신호처리 — 순수 계산만 담는다
   화면도 DOM도 모른다. 그래서 노드에서 그대로 시험할 수 있고,
   나중에 Swift의 Accelerate(vDSP)로 옮길 때 대조하기 쉽다 */

/* ============================================================
   Zero correction
   ============================================================ */

const ZERO_MODES = {
  none:   "없음",
  mean:   "평균 제거",
  first:  "첫 값을 0으로",
  detrend:"선형 추세 제거"
};

/* 구간을 잘라 새 배열로 만들면서 기준점을 맞춘다.
   결측(NaN)은 0으로 채운다 — FFT는 구멍을 못 견딘다 */
function zeroCorrect(values, i0, i1, mode) {
  const n = i1 - i0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i0 + i];
    out[i] = isFinite(v) ? v : NaN;
  }
  if (mode === "mean") {
    let s = 0, c = 0;
    for (let i = 0; i < n; i++) if (isFinite(out[i])) { s += out[i]; c++; }
    const m = c ? s / c : 0;
    for (let i = 0; i < n; i++) out[i] -= m;
  } else if (mode === "first") {
    let base = 0;
    for (let i = 0; i < n; i++) if (isFinite(out[i])) { base = out[i]; break; }
    for (let i = 0; i < n; i++) out[i] -= base;
  } else if (mode === "detrend") {
    /* 최소제곱 직선을 빼낸다. 온도 드리프트가 섞인 데이터에 쓴다 */
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const y = out[i];
      if (!isFinite(y)) continue;
      sx += i; sy += y; sxx += i * i; sxy += i * y; c++;
    }
    const den = c * sxx - sx * sx;
    if (den !== 0) {
      const a = (c * sxy - sx * sy) / den;
      const b = (sy - a * sx) / c;
      for (let i = 0; i < n; i++) out[i] -= a * i + b;
    }
  }
  /* 남은 결측은 0으로 — 여기까지 오면 기준이 이미 0이다 */
  let nan = 0;
  for (let i = 0; i < n; i++) if (!isFinite(out[i])) { out[i] = 0; nan++; }
  return { data: out, filled: nan };
}

/* ============================================================
   필터 — 2차 버터워스를 앞뒤로 두 번 (영위상)
   ============================================================ */

/* RBJ 표준식. Q = 1/√2 이면 버터워스 */
function biquad(kind, fc, fs) {
  const w0 = 2 * Math.PI * fc / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Math.SQRT1_2);
  let b0, b1, b2;
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  if (kind === "low")  { b0 = (1 - cw) / 2; b1 = 1 - cw;    b2 = (1 - cw) / 2; }
  else                 { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function biquadOnce(x, c, reverse) {
  const n = x.length, y = new Float64Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  /* 시작 과도응답을 줄이려고 첫 값으로 상태를 채운다 */
  const first = reverse ? x[n - 1] : x[0];
  x1 = x2 = first; y1 = y2 = first;
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k;
    const xn = x[i];
    const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    y[i] = yn;
  }
  return y;
}

/* 앞으로 한 번, 뒤로 한 번. 위상 지연이 사라지고 차수는 두 배가 된다 */
function filtfilt(x, kind, fc, fs) {
  const c = biquad(kind, fc, fs);
  return biquadOnce(biquadOnce(x, c, false), c, true);
}

const FILTER_MODES = { none:"없음", low:"저역통과 (LPF)", high:"고역통과 (HPF)", band:"대역통과" };

/* 차단주파수는 나이퀴스트보다 낮아야 한다 */
function applyFilter(data, fs, mode, lowCut, highCut) {
  const nyq = fs / 2;
  const notes = [];
  let out = data;
  if (mode === "low" || mode === "band") {
    if (!(lowCut > 0 && lowCut < nyq)) notes.push(`저역통과 차단 ${lowCut} Hz는 0과 나이퀴스트(${fmtHz(nyq)}) 사이여야 합니다`);
    else out = filtfilt(out, "low", lowCut, fs);
  }
  if (mode === "high" || mode === "band") {
    if (!(highCut > 0 && highCut < nyq)) notes.push(`고역통과 차단 ${highCut} Hz는 0과 나이퀴스트(${fmtHz(nyq)}) 사이여야 합니다`);
    else out = filtfilt(out, "high", highCut, fs);
  }
  if (mode === "band" && highCut >= lowCut) notes.push("대역통과는 고역통과 차단이 저역통과 차단보다 낮아야 합니다");
  return { data: out, notes };
}

function fmtHz(v) {
  if (!isFinite(v)) return "—";
  return (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(3)) + " Hz";
}

/* ============================================================
   FFT — 기수-2 쿨리·터키
   ============================================================ */

const WINDOW_SIZES = [1024, 2048, 4096, 8192, 16384];

/* gain   : 진폭 보정 계수 (coherent gain)
   scallop: 봉우리가 격자 사이에 떨어질 때 생기는 최대 손실 (배율).
            보간 보정을 이 값 이상으로는 하지 않는다 — 안 그러면 덧칠된다 */
const WINDOWS = {
  hann:    { label:"Hann",       gain:0.5000, scallop:1.180 },
  hamming: { label:"Hamming",    gain:0.5400, scallop:1.223 },
  rect:    { label:"사각(없음)",  gain:1.0000, scallop:1.571 },
  flattop: { label:"Flat-top",   gain:0.2156, scallop:1.001 }
};

function windowValue(type, i, N) {
  const t = 2 * Math.PI * i / N;
  if (type === "hann")    return 0.5 - 0.5 * Math.cos(t);
  if (type === "hamming") return 0.54 - 0.46 * Math.cos(t);
  if (type === "flattop")
    return 0.21557895 - 0.41663158 * Math.cos(t) + 0.277263158 * Math.cos(2 * t)
         - 0.083578947 * Math.cos(3 * t) + 0.006947368 * Math.cos(4 * t);
  return 1;
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const p = i + j, q = p + half;
        const vr = re[q] * cr - im[q] * ci;
        const vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi;
        re[p] += vr;        im[p] += vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/* 편측 진폭 스펙트럼.
   welch=true 면 50% 겹쳐 여러 조각을 평균한다 — 잡음이 줄고 봉우리가 또렷해진다 */
function spectrum(data, fs, N, winType, welch) {
  const n = data.length;
  const gain = (WINDOWS[winType] || WINDOWS.hann).gain;
  const half = N >> 1;
  const power = new Float64Array(half);

  const step = welch ? (N >> 1) : N;
  let segs = 0;
  const re = new Float64Array(N), im = new Float64Array(N);

  for (let start = 0; start + 1 <= n; start += step) {
    const avail = Math.min(N, n - start);
    if (segs > 0 && avail < N) break;          // 마지막 짧은 조각은 버린다
    re.fill(0); im.fill(0);
    for (let i = 0; i < avail; i++) re[i] = data[start + i] * windowValue(winType, i, N);
    fftInPlace(re, im);
    for (let k = 0; k < half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    segs++;
    if (!welch && avail < N) break;
    if (start + step + N > n && segs > 0) { /* 다음 조각이 모자라면 종료 */ }
  }
  if (!segs) return null;

  const freq = new Float64Array(half), amp = new Float64Array(half);
  const scale = 2 / (N * gain);
  for (let k = 0; k < half; k++) {
    freq[k] = k * fs / N;
    amp[k] = Math.sqrt(power[k] / segs) * scale;
  }
  amp[0] /= 2;                                  // DC는 두 배가 아니다
  return { freq, amp, segments: segs, df: fs / N, nyquist: fs / 2, zeroPadded: n < N };
}

/* 봉우리 찾기.

   그냥 국소 최대를 모으면 봉우리 하나에서 여러 개가 잡힌다.
   실제로 2.700 / 2.748 / 2.766 Hz 처럼 같은 마루의 잔물결이 따로 세어졌다.
   그래서 두 가지를 요구한다.
     - 최소 간격: 이미 뽑은 봉우리와 minSep 안쪽이면 버린다
     - 돌출도: 양옆 골짜기보다 prominence 배 이상 솟아야 한다

   봉우리가 주파수 격자 사이에 떨어지면 진폭이 깎여 보인다(스캘럽 손실).
   로그 영역 포물선 꼭짓점으로 주파수와 진폭을 함께 보정한다 */
function findPeaks(sp, count, winType, opts) {
  const { freq, amp, df } = sp;
  const o = opts || {};
  const cap = (WINDOWS[winType] || WINDOWS.hann).scallop;
  const minSep = o.minSep !== undefined ? o.minSep : df * 6;
  const prom = o.prominence !== undefined ? o.prominence : 1.35;
  const fLo = o.fMin !== undefined ? o.fMin : 0;
  const fHi = o.fMax !== undefined ? o.fMax : Infinity;

  const raws = [];
  for (let k = 2; k < amp.length - 1; k++) {
    if (freq[k] < fLo || freq[k] > fHi) continue;
    if (amp[k] > amp[k - 1] && amp[k] >= amp[k + 1]) raws.push(k);
  }

  /* 좌우로 내려가며 만나는 가장 낮은 골짜기 — 더 높은 봉우리를 만나면 멈춘다 */
  const valley = k => {
    let l = amp[k], r = amp[k];
    for (let i = k - 1; i >= 1; i--) {
      if (amp[i] > amp[k]) break;
      if (amp[i] < l) l = amp[i];
    }
    for (let i = k + 1; i < amp.length; i++) {
      if (amp[i] > amp[k]) break;
      if (amp[i] < r) r = amp[i];
    }
    return Math.max(l, r);
  };

  const cands = raws
    .filter(k => amp[k] >= valley(k) * prom)
    .sort((a, b) => amp[b] - amp[a]);

  const picked = [], out = [];
  for (const k of cands) {
    if (out.length >= count) break;
    if (picked.some(f => Math.abs(freq[k] - f) < minSep)) continue;
    const EPS = 1e-300;
    const a = Math.log(amp[k - 1] + EPS), b = Math.log(amp[k] + EPS), c = Math.log(amp[k + 1] + EPS);
    const den = a - 2 * b + c;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    const lifted = Math.exp(b - 0.25 * (a - c) * shift);
    picked.push(freq[k]);
    out.push({
      freq: freq[k] + shift * df,
      amp: Math.min(lifted, amp[k] * cap),
      raw: amp[k],
      index: k
    });
  }
  return out;
}

/* ============================================================
   기본진동수 추정 — 진동법의 성패가 여기서 갈린다
   ============================================================ */

/* 봉우리 하나를 1차 모드로 잘못 집으면 장력이 4배, 9배로 틀린다.
   그래서 최대 봉우리를 쓰지 않고, 봉우리들이 f1의 정수배로 늘어서는지를 본다.
   f1 후보는 "각 봉우리 ÷ 1..8" 이고, 낮은 차수가 실제로 보이는 쪽을 선호한다 */
/* f1 후보 하나를 채점한다.

   두 가지를 조심한다.
   1) 차수 하나에 봉우리 하나만 센다. 안 그러면 잡음 봉우리 여러 개가
      모두 "1차"로 계산되어 터무니없이 큰 f1이 최고점을 받는다.
   2) 점수는 "가장 긴 연속 차수 구간"으로 낸다. 멀리 떨어진 잡음 차수
      하나가 끼면(예: 1,2,3,4,5,10) 간격 벌점이 정답을 짓누른다. */
function scoreFundamental(sortedFreqs, f1, MAXN) {
  if (!(f1 > 0)) return null;
  const bestPerOrder = new Map();
  for (const f of sortedFreqs) {
    const k = Math.round(f / f1);
    if (k < 1 || k > MAXN + 4) continue;
    const e = Math.abs(f - k * f1) / f1;
    if (e >= 0.06) continue;
    if (!bestPerOrder.has(k) || e < bestPerOrder.get(k)) bestPerOrder.set(k, e);
  }
  const all = [...bestPerOrder.keys()].sort((a, b) => a - b);
  if (!all.length) return null;

  let run = [all[0]], bestRun = run;
  for (let i = 1; i < all.length; i++) {
    if (all[i] === all[i - 1] + 1) run.push(all[i]);
    else run = [all[i]];
    if (run.length > bestRun.length) bestRun = run;
  }

  const matched = bestRun.length;
  const err = bestRun.reduce((a, k) => a + bestPerOrder.get(k), 0) / matched;
  const extras = all.length - matched;
  const lowBonus = bestRun[0] === 1 ? 0.6 : (bestRun[0] === 2 ? 0.25 : 0);
  return {
    f1, matched, orders: bestRun, allOrders: all, meanErr: err,
    score: matched - 4 * err + 0.1 * extras + lowBonus,
    extrapolated: bestRun[0] > 2
  };
}

function estimateFundamental(peaks, maxOrder) {
  const fs = peaks.map(p => p.freq).filter(f => f > 0).sort((a, b) => a - b);
  if (!fs.length) return null;
  const MAXN = maxOrder || 8;

  let best = null;
  for (const p of fs) {
    for (let n = 1; n <= MAXN; n++) {
      const c = scoreFundamental(fs, p / n, MAXN);
      if (c && (!best || c.score > best.score + 1e-9)) best = c;
    }
  }
  if (!best) return null;

  /* 부조화 확인. f1의 절반·1/3도 배음 열에 얹히므로 그냥 최고점을 쓰면
     장력이 1/4, 1/9로 나온다. 정수배를 다시 채점해 거의 같은 점수면 큰 쪽을 쓴다 */
  for (const k of [2, 3]) {
    const up = scoreFundamental(fs, best.f1 * k, MAXN);
    if (up && up.score >= best.score - 0.3) best = up;
  }
  return best;
}

/* 추정한 f1에 봉우리들을 차수별로 붙여 표로 만든다 */
function harmonicTable(peaks, f1) {
  return peaks
    .map(p => {
      const n = Math.round(p.freq / f1);
      return n >= 1 ? { n, freq: p.freq, amp: p.amp, implied: p.freq / n } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}
