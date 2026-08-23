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
   봉우리가 주파수 격자 사이에 떨어지면 진폭이 깎여 보인다(스캘럽 손실).
   포물선 꼭짓점을 구해 주파수와 진폭을 함께 보정한다 */
function findPeaks(sp, count, winType) {
  const { freq, amp, df } = sp;
  const cap = (WINDOWS[winType] || WINDOWS.hann).scallop;
  const found = [];
  for (let k = 2; k < amp.length - 1; k++) {
    if (amp[k] > amp[k - 1] && amp[k] >= amp[k + 1]) {
      /* 로그(dB) 영역에서 포물선을 맞춘다. 창함수 봉우리 모양이 로그에서 훨씬 포물선에 가깝다 */
      const EPS = 1e-300;
      const a = Math.log(amp[k - 1] + EPS), b = Math.log(amp[k] + EPS), c = Math.log(amp[k + 1] + EPS);
      const den = a - 2 * b + c;
      const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
      const peakLog = b - 0.25 * (a - c) * shift;
      const lifted = Math.exp(peakLog);
      found.push({
        freq: freq[k] + shift * df,
        amp: Math.min(lifted, amp[k] * cap),   // 창함수가 허용하는 만큼만 올린다
        raw: amp[k],
        index: k
      });
    }
  }
  found.sort((p, q) => q.amp - p.amp);
  return found.slice(0, count);
}
