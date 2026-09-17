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
| Fundamental | Harmonic product spectrum over 5 harmonics, which stops it locking onto the 2nd harmonic and reporting double rpm |
| Refine | Parabolic interpolation on the log-magnitude peak, resolving between bins |
| Gate | Median-of-5 smoothing plus a confidence threshold; below it the last value is held and greyed rather than flickering |

## Self-test

The app opens in **self-test** mode, feeding the detector a synthetic rotor
signature — harmonics, a pink noise floor, and the sub-100 Hz rolloff a handset
microphone actually has. Move the test-tone slider and the measured value should
track it. Measured error on a 2-blade head at 2 137 rpm is about +7 rpm, roughly
one sixth of a bin.

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
