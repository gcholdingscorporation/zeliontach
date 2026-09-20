"use strict";
/* Iterative radix-2 Cooley-Tukey, in place, real input. Sized once and reused,
   because a 32768-point transform runs tens of times per second of audio. */

function FFT(n){
  if((n & (n - 1)) !== 0) throw new Error("FFT size must be a power of two, got " + n);
  this.n = n;
  this.re = new Float64Array(n);
  this.im = new Float64Array(n);
  this.cos = new Float64Array(n / 2);
  this.sin = new Float64Array(n / 2);
  for(let i = 0; i < n / 2; i++){
    this.cos[i] = Math.cos(-2 * Math.PI * i / n);
    this.sin[i] = Math.sin(-2 * Math.PI * i / n);
  }
  this.rev = new Uint32Array(n);
  let bits = 0;
  while((1 << bits) < n) bits++;
  for(let i = 0; i < n; i++){
    let r = 0;
    for(let b = 0; b < bits; b++) if(i & (1 << b)) r |= 1 << (bits - 1 - b);
    this.rev[i] = r;
  }
}

/* Transform `input` (length n, real) and write |X[k]| for k < n/2 into `mag`. */
FFT.prototype.magnitude = function(input, mag){
  const n = this.n, re = this.re, im = this.im, rev = this.rev, cos = this.cos, sin = this.sin;
  for(let i = 0; i < n; i++){ re[rev[i]] = input[i]; im[rev[i]] = 0; }

  for(let size = 2; size <= n; size <<= 1){
    const half = size >> 1, step = n / size;
    for(let i = 0; i < n; i += size){
      for(let j = i, k = 0; j < i + half; j++, k += step){
        const c = cos[k], s = sin[k];
        const tr = re[j + half] * c - im[j + half] * s;
        const ti = re[j + half] * s + im[j + half] * c;
        re[j + half] = re[j] - tr; im[j + half] = im[j] - ti;
        re[j] += tr;               im[j] += ti;
      }
    }
  }
  for(let k = 0; k < n / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
};

module.exports = { FFT };
