# Zelion Tach

An acoustic tachometer for RC helicopter head speed. It reads rpm from the phone
microphone — no sensor, no magnet, no hardware.

**Live:** https://gcholdingscorporation.github.io/zeliontach/

Enable it under **Settings → Pages → Deploy from a branch**, selecting the branch
this code is on and the `/ (root)` folder.

## How it works

A rotor radiates a tone at its **blade-pass frequency**:

    f_blade = rpm × blades ÷ 60        rpm = 60 × f_blade ÷ blades

Two blades at 1 000–6 000 rpm puts that between 33 Hz and 200 Hz, comfortably
inside what a phone microphone resolves.

The signal chain:

| Stage | What it does |
|---|---|
| Capture | `getUserMedia` with echo cancellation, noise suppression and auto-gain **off**, so the low-frequency rotor tone survives |
| Transform | 32 768-point FFT, smoothing disabled — 1.46 Hz bins at 48 kHz, i.e. 44 rpm per bin on a 2-blade head |
| Fundamental | Harmonic product spectrum over 5 harmonics, searched from 300 rpm upward — never floored at the expected minimum |
| Correction | Sub-harmonic descent: `f/d` is accepted as the real fundamental only when the partials it adds, which `f` cannot account for, are present. For `d=2` those are the odd multiples 1, 3, 5 of `f/2`, and two thirds must be there so one attenuated member cannot sink the test |
| Slew gate | A candidate implying more than 4 500 rpm/s of change is held back until three consecutive frames agree, which kills harmonic-slip transients without blocking a real spool-up |
| Refine | Parabolic interpolation on the log-magnitude peak, resolving between bins |
| Gate | Median-of-5 smoothing plus a confidence threshold; below it the last value is held and greyed rather than flickering |

## Two things that steal the lock

**Harmonics.** A mic rolls off steeply below ~200 Hz, so the fundamental can sit
25 dB under its own harmonics and a naive pick returns 2x or 4x the real speed.

**The tail rotor.** Geared several times faster than the head and sitting where a
phone mic is *most* sensitive, it is often the louder comb — and because the tail
ratio is not an integer, it is not a harmonic of the head and cannot be divided
back down. For a 4.53:1 tail on two blades it lands inside a 1000–6000 rpm search
band whenever the head is below ~1500 rpm, which is precisely the spool-up window:

| Head rpm | Tail blade-pass | Reads as |
|---:|---:|---:|
| 800 | 120.8 Hz | 3 624 rpm |
| 1 000 | 151.0 Hz | 4 530 rpm |
| 1 300 | 196.3 Hz | 5 889 rpm |

The detector answers both by scoring *every* ridge in the HPS curve as a competing
explanation, keeping those with a fully formed comb, and taking the **lowest**
one. Loudness is deliberately not a factor: six real peaks on exact multiples do
not happen by chance, and the head is always below anything driven off it. Any
well-formed comb above the reading is reported on screen rather than hidden.

## Why the search floor matters

A microphone — and far more so a small speaker — rolls off steeply below about
200 Hz. A rotor at 800 rpm on two blades has its fundamental at 26.7 Hz, which
can sit 25 dB below its own harmonics. Flooring the search at the expected
minimum rpm leaves the fundamental outside the window entirely, so the detector
locks onto whichever harmonic falls inside and reports an integer multiple.

Measured on a simulated spool-up through a small speaker, floor-at-minimum
versus the current detector:

| True rpm | Floored at minimum | Current |
|---:|---:|---:|
| 400 | 1 187 (3×) | 400 |
| 800 | 3 208 (4×) | 800 |
| 1 300 | 2 593 (2×) | 1 300 |
| 2 000 | 3 999 (2×) | 2 000 |
| 2 400 | 4 790 (2×) | 2 400 |

Readings below the expected minimum are shown and marked out of range rather
than forced into it, and they never set the peak hold.

## Self-test

The app opens in **self-test** mode, feeding the detector a synthetic rotor
signature — harmonics, a pink noise floor, and the sub-100 Hz rolloff a handset
microphone actually has. Move the test-tone slider and the measured value should
track it. Measured error on a 2-blade head at 2 137 rpm is about +7 rpm, roughly
one sixth of a bin.

**Recording mode** decodes an audio or video file straight into the detector, with
no speaker and no microphone in the path. This is the way to check the app against
a clip whose real head speed you already know — playing a clip through a speaker
into a mic destroys the fundamental before the detector ever sees it, because a
small speaker cannot reproduce 30–60 Hz at any useful level.

Verify against a real signal before trusting it: a bench motor with ESC telemetry,
or an optical tachometer.

## Requirements

Microphone capture needs **https** and a **top-level browser tab**. An embedded
frame is only given a microphone if the framing page delegates that permission,
which is why this exists as a standalone page rather than only as an embed.

Add to home screen for a full-screen, offline-capable install.

## Not an airworthiness instrument

This is a tuning aid for RC models. It is uncertified, it can be fooled by a
strong harmonic, and it must not be used to decide whether any rotor system is
safe to fly.
