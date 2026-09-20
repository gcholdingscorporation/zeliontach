# Detector test matrix

Runs the detector that ships in `index.html` — the real one, sliced out of the
page and driven headlessly — over audio whose head speed is already known, and
scores what comes back.

```
node test/run.js                    # everything
node test/run.js --filter=field     # cases whose id or tag contains "field"
node test/run.js --json=out.json    # results as JSON as well
node test/run.js --hop-ms=16        # analyse more often (slower, closer to 60 fps)
```

No dependencies. Node 18 or newer.

## How it works

`harness/extract.js` slices the constants, state, detector, tracker and frame
sections out of `index.html` by their banner comments and evaluates them in a
sandbox with the browser bits stubbed. That is deliberate: a harness holding its
own copy of the detector drifts away from the shipping one and then passes while
the app fails. If a banner is renamed the slice throws rather than quietly
testing nothing.

`harness/spectrum.js` reproduces what `AnalyserNode.getFloatFrequencyData` hands
the app — Blackman window, transform, magnitude over `fftSize`, then dB — so the
numbers the detector sees offline are the numbers it sees in the browser.

The tracker ages candidates in wall-clock milliseconds, so the run drives a
virtual clock in step with the audio rather than with how fast the host chews
through FFTs. Results are the same on a fast machine and a slow one.

`harness/make-sample.js` writes a synthetic clip out as a WAV, which exercises
the recording path without waiting for a real capture and gives you a file to
drop into the app's own Recording input:

```
node test/harness/make-sample.js recordings/probe.wav 2137 2 8
```

If the page and this harness disagree about that clip, one of them is wrong and
neither should be trusted about a real one.

## The two matrices

`matrix/synthetic.json` — signals this project generates. They prove the harness
measures what it claims and they hold the detector's known failure shapes as
regressions. **They are not evidence that the detector works.** A generator
cannot produce the thing the detector is built to survive.

`matrix/field.json` — real recordings with measured head speeds. This is the
one that decides whether a detection change was an improvement. See
[CAPTURING.md](CAPTURING.md) for how to take one, and in particular for what
counts as ground truth.

## Case format

| Field | Meaning |
| --- | --- |
| `id` | unique; also what `--filter` matches |
| `kind` | `recording` (a file) or `synthetic` (generated) |
| `audio` | path relative to `test/`, for `recording` |
| `signal` | generator parameters, for `synthetic` |
| `truth.rpm` | the known head speed; or `truth.segments` for a clip that changes |
| `truth.source` | how that head speed was measured — required for a real capture |
| `truth.blades` | blade count the detector should be set to |
| `conditions` | distance, wind, background, device: prose, for the reader |
| `band.rpmMin` / `band.rpmMax` | the range the app is set to |
| `expect` | the bar this case has to clear |
| `goal` | where we want the case to get to, when it is not there yet |
| `tags` | free-form; `--filter` matches these too |

### Expectations

| Key | Default | Meaning |
| --- | --- | --- |
| `tol_rpm` | 50 | a reading within this of truth is correct |
| `min_within_pct` | 90 | share of judged readings that must be within `tol_rpm` |
| `max_final_error_rpm` | — | error of the settled reading at the end of the clip |
| `max_gross` | — | cap on readings more than `gross_pct` off — usually octave errors |
| `gross_pct` | 10 | what counts as gross, as a percentage of truth |
| `must_lock` | true | the clip contains a rotor and the detector has to find it |
| `lock_within_s` | 8 | how long it may take |
| `settle_s` | 1.5 | grace after first lock before readings are judged |
| `must_not_lock_in_band` | false | for a clip with no rotor: nothing may be reported inside the band |

A case whose expectations are set to where the detector is *today* still earns
its keep — it catches the regression. Put where you want it to get to in `goal`,
which prints alongside the result and changes nothing.

## Current baseline

Every synthetic case passes. Three carry a `goal` because passing is not the
same as good:

- A clean ten-second lock reads the head speed exactly for nine seconds, then
  wanders about 3% in its last second as a neighbouring track matures.
- Heavy wind — noise 14 dB above the rotor — settles on the right answer but
  swings wildly on the way there.
- A clip of wind with no rotor in it eventually reports a figure far below the
  band, driven by the wind's own low-frequency energy. The app marks an
  out-of-band reading, so a user is not told a wrong head speed, but the honest
  answer is nothing at all.

`matrix/field.json` is a capture checklist, not results. Until it holds real
audio, nothing here tells you the detector works in a field.
