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
| Whiten | The noise floor is estimated and subtracted, so broadband noise cannot tilt the scoring |
| Guard | Sub-multiple combs are folded up to the real fundamental by comparing the strength of the partials they add against the ones they share |
| Track | Candidates are scored across frames, so transients never accumulate enough history to be believed |
| Gate | Median-of-5 smoothing plus a confidence threshold; below it the last value is held and greyed rather than flickering |

## Holding a lock in a noisy field

Three things carry the detector through wind, traffic and other models.

**Whitening.** The noise floor is estimated and subtracted before anything
else, so a tilted floor — wind, road rumble, the handset's own rolloff —
cannot bias a score that sums decibels across harmonics. Every peak is then
worth the same wherever it sits.

**The octave guard.** A comb at half the true fundamental contains every real
harmonic *and* the silent gaps between them, so counting partials cannot tell
the two apart — both score six out of six. Strength can. On a real recording
the fake at half read 9 dB on the partials it *adds* against 44 dB on the ones
it *shares*; a gap that size folds the candidate up to the real fundamental.

**Tracking across frames.** A rotor tone persists and drifts slowly; a shout,
a gust or a passing model does not. Candidates are scored over time, so a
transient never accumulates enough history to be believed however loud it was
for a moment. The expected range is a preference in that scoring, never a
filter.

Measured over 460 frames of simulated field audio, against the same detector
making each decision from one frame alone:

| | within 50 rpm | gross errors |
|---|---:|---:|
| tracked | **93%** | **3** |
| single frame | 81% | 75 |

The cost is about three frames — a fifth of a second — before a new tone is
believed, which is why the clean cases sit at 95% rather than 100%.

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

## Releases

Pushing a tag of the form `v1.2.3` builds a signed APK and attaches it to a
GitHub Release, so a build stays downloadable instead of expiring with the
`Build APK` workflow's artifacts:

    git tag v1.0.0 && git push origin v1.0.0

The release is signed with a real key that is never committed. Before the first
tag, create a keystore and put it in the repository's Actions secrets
(**Settings -> Secrets and variables -> Actions**):

    keytool -genkeypair -v -keystore release.jks -alias zeliontach \
            -keyalg RSA -keysize 2048 -validity 10000
    base64 -w0 release.jks        # macOS: base64 -i release.jks

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 line printed above |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | the alias, `zeliontach` above |
| `ANDROID_KEY_PASSWORD` | the key password |

Keep `release.jks` somewhere safe and offline, and never commit it. Every
future release has to be signed with the same key, or an installed copy cannot
be upgraded in place — it has to be uninstalled first, losing its settings.

A tag with a suffix — `v1.1.0-beta1` — is published as a prerelease, and the
release that follows it upgrades it in place. `versionName` comes from the tag;
`versionCode` is derived from it so it always increases. A build with no tag
behind it, from `Build APK`, is still signed with the committed throwaway
`sideload.keystore` and is not a release.

## Not an airworthiness instrument

This is a tuning aid for RC models. It is uncertified, it can be fooled by a
strong harmonic, and it must not be used to decide whether any rotor system is
safe to fly.
