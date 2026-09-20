# Detection regression

Runs the detector exactly as it ships. `extract.js` slices the DSP out of
`index.html` and evaluates it, so there is no second copy of the algorithm to
drift out of step with the app — change the page and the next run measures the
change.

```
node tools/regression/run.js              # summary for one noise draw
node tools/regression/run.js --verbose    # every case, one per line
node tools/regression/run.js --group=wind # one group
node tools/regression/run.js --check      # hold the bar across five draws; exits 1 if it slips
ZT_HTML=/path/old.html node tools/regression/run.js   # measure another build
ZT_SEED=101 node tools/regression/run.js              # a different noise draw
```

## What it measures

Each case is 3.0 s of spectra at the 70 ms cadence `loop()` enforces, fed
frame by frame so the multi-frame tracker is exercised the way it is in the
field. The groups:

| group | what it is |
| --- | --- |
| `clean` | rock-steady rotor, no noise. The bench result: the readout must show the injected figure exactly. |
| `governed` | a rotor wandering as a governor actually holds it |
| `wind` | a raised, tilted, gusting low-frequency floor at four signal levels |
| `tail` | a real tail-rotor comb above the head, at three gear ratios |
| `ground` | a generator, an idling engine or a vehicle beside the helicopter |
| `ambient` | no helicopter at all. Any lock here is a false positive. |
| `transient` | a rotor plus one-off clatter |

`within50` is the share of rotor cases read within 50 rpm. `gross` is a
reading more than 200 rpm out — a doubled or halved lock, not a near miss.
`no-lock` is the detector declining to show a figure, which is the safe
outcome, not a correct one. `false-lock` counts ambient cases that produced a
reading; `(n flagged)` are the ones outside the pilot's stated band, which the
readout already marks.

## Known gaps

- A machine on the ground that is **louder than the helicopter and inside the
  stated rpm band** still wins. The `ground 50Hz` case is this: a 50 Hz comb is
  indistinguishable from a 2-blade head at 1500 rpm on spectrum shape alone.
- Same cause, no rotor present: `ambient generator 50Hz` reports 1500 rpm.
- Heavy wind at the two lowest signal levels gives no lock. The fundamental is
  under 10 dB above the floor there and the middle harmonics are buried, so
  declining is the right answer.

Separating a rotor from a steady machine at the same pitch needs a cue this
matrix does not carry — peak width, or frame-to-frame frequency wander, which
a rotor has and a mains-locked generator does not. That wants real recordings
to calibrate against, not synthesis, or it just measures its own assumptions.
