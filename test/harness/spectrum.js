"use strict";
/* Reproduce what AnalyserNode.getFloatFrequencyData hands the app.
 *
 * The detector is written against that exact array - Blackman-windowed, scaled
 * by fftSize, in dB - so an offline spectrum that differs in windowing or
 * scaling would be testing a detector nobody ships. Per the Web Audio spec:
 * window the fftSize time-domain samples with Blackman, transform, divide the
 * magnitude by fftSize, take 20*log10. smoothingTimeConstant is 0 in the app,
 * so there is no smoothing to carry between frames. */

const { FFT } = require("./fft.js");

const MIN_DB = -1000;                    /* what a digital-silence bin becomes */

function Spectrograph(fftSize){
  this.fftSize = fftSize;
  this.bins = fftSize >> 1;
  this.fft = new FFT(fftSize);
  this.buf = new Float64Array(fftSize);
  this.mag = new Float64Array(this.bins);
  this.win = new Float64Array(fftSize);
  const N = fftSize;
  for(let n = 0; n < N; n++)
    this.win[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / N) + 0.08 * Math.cos(4 * Math.PI * n / N);
}

/* dB spectrum of samples[offset .. offset+fftSize), zero-padded at the tail. */
Spectrograph.prototype.frameAt = function(samples, offset, out){
  const N = this.fftSize, buf = this.buf, win = this.win;
  for(let n = 0; n < N; n++){
    const i = offset + n;
    buf[n] = (i >= 0 && i < samples.length ? samples[i] : 0) * win[n];
  }
  this.fft.magnitude(buf, this.mag);
  for(let k = 0; k < this.bins; k++){
    const m = this.mag[k] / N;
    out[k] = m > 0 ? 20 * Math.log10(m) : MIN_DB;
  }
  return out;
};

module.exports = { Spectrograph, MIN_DB };
