/* Field-noise scenario matrix.
   Each scenario yields a sequence of dB spectra as the analyser would hand
   them to frame(), plus the ground truth head speed (null = no rotor present,
   so any lock is a false positive). Everything is seeded: same matrix, same
   numbers, every run. */
"use strict";

var BINS = 2600;                     /* what the page actually feeds frame() */

function prng(seed){
  var s = seed >>> 0;
  return function(){ s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s/0x7fffffff; };
}

/* Build one frame in the power domain, then hand back dB. */
function Spectrum(binHz, bins, rand){
  this.binHz = binHz; this.n = bins; this.rand = rand;
  this.p = new Float64Array(bins);
}
Spectrum.prototype.addFloor = function(level, tilt){
  /* level dB at 1 kHz, tilt dB per decade below it (wind and handset rolloff
     both tilt the floor; the whitener is supposed to take this out) */
  for(var i = 0; i < this.n; i++){
    var f = Math.max(1, i*this.binHz);
    var dB = level + tilt*Math.log10(1000/f) + (this.rand()-0.5)*7;
    this.p[i] += Math.pow(10, dB/10);
  }
};
/* A periodic source: fundamental f0, amplitude amp dB, harmonics rolling off.
   `rolloff` is dB per octave of harmonic number; `lowCut` models the handset
   mic losing the bottom end. */
Spectrum.prototype.addComb = function(f0, amp, harmonics, rolloff, lowCut){
  for(var h = 1; h <= harmonics; h++){
    var f = f0*h;
    if(f/this.binHz > this.n - 4) break;
    var roll = (lowCut && f < lowCut) ? -20*Math.log10(lowCut/f) : 0;
    var a = amp - rolloff*Math.log2(h) + roll;
    var kc = f/this.binHz;
    for(var k = Math.max(1, Math.floor(kc)-3); k <= Math.floor(kc)+3; k++){
      if(k >= this.n) break;
      this.p[k] += Math.pow(10, (a - 11*(k-kc)*(k-kc))/10);
    }
  }
};
/* Broadband burst: a shout, a clatter, a gust hitting the mic. */
Spectrum.prototype.addBurst = function(loHz, hiHz, amp){
  var lo = Math.floor(loHz/this.binHz), hi = Math.min(this.n-1, Math.ceil(hiHz/this.binHz));
  for(var k = lo; k <= hi; k++) this.p[k] += Math.pow(10, (amp + (this.rand()-0.5)*9)/10);
};
Spectrum.prototype.toDb = function(){
  var out = new Float32Array(this.n);
  for(var i = 0; i < this.n; i++) out[i] = 10*Math.log10(this.p[i] + 1e-30);
  return out;
};

/* ---- the matrix ------------------------------------------------------- */
/* Every case is 3.0 s of frames at the 70 ms cadence loop() enforces. */
var FRAMES = 43, DT = 70;

function build(opts){
  var rand = prng(opts.seed);
  var blades = opts.blades || 2;
  var frames = [];
  for(var i = 0; i < FRAMES; i++){
    var t = i*DT/1000;
    var s = new Spectrum(opts.binHz, BINS, rand);
    s.addFloor(opts.floor != null ? opts.floor : -94, opts.tilt != null ? opts.tilt : 9);

    if(opts.rpm != null){
      /* a governor holds speed but wanders a few rpm; wander 0 is the bench
         case, where the reading must come back exactly */
      var wob = opts.wander != null ? opts.wander : 1;
      var rpm = opts.rpm + (Math.sin(t*5.7)*6 + Math.sin(t*1.9)*4)*wob;
      s.addComb(rpm*blades/60, opts.rotorAmp != null ? opts.rotorAmp : -24, 14, 13, 110);
      frames.truth = rpm;
    }
    if(opts.tail){            /* tail rotor: a real, persistent, higher comb */
      var tf = opts.rpm*blades/60*opts.tail.ratio;
      s.addComb(tf, opts.tail.amp, 8, 13, 110);
    }
    if(opts.competitor){      /* generator, idling engine, vehicle: persistent */
      var c = opts.competitor;
      s.addComb(c.f0, c.amp, c.harmonics || 12, c.rolloff != null ? c.rolloff : 9, 110);
    }
    if(opts.gust){            /* non-stationary wind */
      var g = 0.5 + 0.5*Math.sin(t*2.1);
      s.addBurst(5, 400, opts.gust + 12*g);
    }
    if(opts.transientAt && Math.abs(t - opts.transientAt) < 0.12)
      s.addBurst(opts.transientLo || 80, opts.transientHi || 1800, opts.transientAmp || -30);

    frames.push(s.toDb());
  }
  return frames;
}

function matrix(binHz, seedBase){
  var cases = [], seed = (seedBase == null ? 7 : seedBase);
  function add(group, name, opts, truth){
    opts.binHz = binHz; opts.seed = seed++;
    cases.push({ group:group, name:name, opts:opts, truth:truth });
  }

  /* A. clean signal, rock steady - the bench result that must not regress */
  [1200, 1600, 2000, 2137, 2400, 2800, 3200].forEach(function(r){
    add("clean", "clean " + r, { rpm:r, wander:0 }, r);
  });

  /* A2. clean but governed, so the reading chases a moving target */
  [1600, 2137, 3200].forEach(function(r){
    add("governed", "governed " + r, { rpm:r }, r);
  });

  /* B. wind and a raised, tilted floor at falling signal-to-noise */
  [-30, -34, -38, -42].forEach(function(amp){
    [6, 16, 24].forEach(function(tilt){
      add("wind", "wind tilt" + tilt + " amp" + amp,
          { rpm:2137, rotorAmp:amp, floor:-88, tilt:tilt, gust:-58 }, 2137);
    });
  });

  /* C. tail rotor present - a genuine competing comb above the head */
  [4.1, 4.7, 5.3].forEach(function(ratio){
    [-26, -22].forEach(function(amp){
      add("tail", "tail x" + ratio + " amp" + amp,
          { rpm:2137, tail:{ ratio:ratio, amp:amp } }, 2137);
    });
  });

  /* D. a persistent ground source BELOW the head fundamental: generator,
     idling engine, vehicle. This is the field case the app is for. */
  [{ f0:25, amp:-26 }, { f0:33.3, amp:-24 }, { f0:41.7, amp:-28 },
   { f0:50, amp:-22 }, { f0:29, amp:-30 }].forEach(function(c){
    add("ground", "ground " + c.f0 + "Hz amp" + c.amp,
        { rpm:2137, competitor:c }, 2137);
  });

  /* E. ambient only - no helicopter at all. Any lock here is a false positive. */
  add("ambient", "ambient wind only", { floor:-88, tilt:20, gust:-52 }, null);
  add("ambient", "ambient generator 50Hz", { floor:-90, tilt:12, competitor:{ f0:50, amp:-24 } }, null);
  add("ambient", "ambient engine 29Hz", { floor:-90, tilt:14, competitor:{ f0:29, amp:-26 } }, null);
  add("ambient", "ambient traffic", { floor:-86, tilt:22, gust:-50, competitor:{ f0:18, amp:-32 } }, null);

  /* F. rotor plus one-off transients */
  [0.8, 1.6, 2.3].forEach(function(at){
    add("transient", "transient at " + at + "s",
        { rpm:2137, transientAt:at, transientAmp:-26 }, 2137);
  });

  return cases;
}

module.exports = { matrix: matrix, build: build, BINS: BINS };
