# Capturing real audio for the test matrix

Everything in `matrix/synthetic.json` is a signal this project generated itself.
It can only ever confirm that the detector still behaves the way it behaved
yesterday. It cannot tell you whether the detector works, because the thing it
is built to survive — real wind over a real microphone, a real rotor at a real
distance, real background — is exactly what a generator does not produce.

This file is the part a person has to do.

## What you need per capture

**1. Audio.** Record with the phone you actually care about, and do not trim,
normalise or noise-reduce it afterwards. Whatever the recorder does to the
signal is part of what the detector has to cope with, so leave it in. Ten to
thirty seconds is plenty; a minute is better if the head speed is changing.

**Video is fine, and is often better**, because a tach in frame answers the
ground-truth problem below in the same file. Hand the harness the `.mp4` or
`.mov` as it came off the phone; it takes the audio track itself. Measured on a
generated clip, AAC does not cost anything that matters here: 128 kbps at
48 kHz, 96 kbps at 44.1 kHz and even 64 kbps mono at 44.1 kHz all read the head
speed exactly, which makes sense — the comb lives under about 1 kHz, where a
codec spends its bits. A long video is several cases, not one: give each case
its own `clip` window.

**One caution, and it is the reason not to film everything.** A phone's video
mode does not necessarily apply the same processing as its voice recorder, and
wind suppression is exactly the kind of thing that differs. Since wind is the
detector's known weak spot, footage whose wind has already been cleaned up
quietly makes the hard cases look easy. So in wind, take a plain audio capture
alongside the video, back to back in the same conditions, and put both in the
matrix. If the two disagree, the phone is doing something to one of them and
you want to know which.

**2. Ground truth — a head speed you measured, not one you assumed.** This is
the whole value of the capture and the easiest thing to get wrong. A clip with
no answer key is not a test case, however good the audio is.

There are three tiers, and the manifest should say which one a capture is on,
because the tier is what sets a fair tolerance.

**Tier 1 — measured, in the same take.** An optical or laser tachometer on the
rotor, or the aircraft's own tach visible in frame. Because the instrument and
the sound are in the same recording, they are already in sync and no clock
needs reconciling. Note the reading and the second it was taken:
`"source": "cockpit tach in frame, 2100 rpm at 00:06"`. Judge these at the
tolerance you actually care about — `tol_rpm: 50` or tighter.

**Tier 2 — measured, separately.** A tach read on the ground, or an instrument
recorded on a different device. Usable, but you now own the sync: say in
`truth.source` how the two were lined up, and expect the tolerance to absorb
whatever slop that alignment has.

**Tier 3 — nominal.** A known type on a governed head, with the governor
confirmed engaged and in the green. This is a number from a manual, not a
measurement, and it should be labelled that way:
`"source": "nominal for type, governed and in the green - not measured"`.
Run these at a wider tolerance and never let one be the reason you believe a
detection change helped.

Outside-shot footage with no instruments anywhere in frame is **tier zero**: it
is audio with no answer key. It is not useless — it is fine for the negative
cases, where the right answer is "nothing", and for eyeballing behaviour — but
it cannot score, so do not add it to the matrix as though it can.

Do not use this app's own reading as ground truth. A test whose answer comes
from the thing under test proves nothing.

**3. Conditions.** Distance, wind, background, device, and where the mic was
pointing. These are what make one capture different from another, and a matrix
of twenty clips all taken on a calm day fifty metres away is one clip taken
twenty times.

## What the matrix needs covered

The detector's known weak spots are wind and ambient confusion, so those are
where captures earn their keep. Aim to cover, roughly in this order:

| Axis | Spread worth having |
| --- | --- |
| Distance | close (under 20 m), mid (50–100 m), far (200 m+, where it is faint) |
| Wind | still, breezy, and at least two takes in wind strong enough to roar on the mic |
| Wind shielding | bare mic and shielded mic in the same conditions, back to back |
| Background | quiet ground, road or traffic, other machinery running, voices nearby |
| Competing source | a second aircraft or motor audible at the same time |
| Head speed | steady, and at least one spool-up and one spool-down |
| Nothing to find | wind and background with no rotor present at all — a clip where the right answer is silence |

Two takes per row beats one. A row with a single clip tells you what happened
once.

## Recording each capture in the manifest

Drop the file in `test/recordings/` under its case id, then add an entry to
`test/matrix/field.json`:

```json
{
  "id": "field-mid-breezy-01",
  "kind": "recording",
  "tags": ["field", "wind"],
  "audio": "recordings/field-mid-breezy-01.m4a",
  "truth": {
    "rpm": 2100,
    "blades": 2,
    "source": "optical tach on the head, read at 00:06"
  },
  "conditions": {
    "distance_m": 60,
    "wind": "breezy, gusting, no shield on the mic",
    "background": "open field, distant road",
    "device": "Pixel 8, built-in mic, Recorder app",
    "notes": "steady head speed throughout"
  },
  "band": { "rpmMin": 1000, "rpmMax": 6000 },
  "expect": { "tol_rpm": 50, "min_within_pct": 90 }
}
```

The phone's original file goes in as-is — `.m4a`, `.mp4` and `.mov` are all
fine and are what a phone produces. The harness converts it to WAV once with
ffmpeg, dropping any video track, and ignores the conversion from then on.

Two optional fields matter for video:

```json
"clip": { "from_s": 42, "to_s": 68 },
"audio_channel": "left"
```

`clip` takes one window out of a longer file, so a single flight becomes a case
per pass, each with its own distance and wind. `audio_channel` picks one side of
a stereo track instead of averaging the pair — phones build that pair out of
two or three mics with their own processing, and averaging can partly undo
whatever steering it did. Default is `mix`; on a capture that matters, run it
both ways and see whether it moves.

Leave `expect` off a brand-new capture if you do not yet know what is
reasonable to ask of it. Run it, look at what the detector actually does, and
then write down a bar. A bar invented before the first run is a guess wearing a
number.

## When you have no audio yet

A case with an `audio` path that is not in the tree reports `awaiting audio` and
does not fail the run. So the matrix doubles as the capture checklist: declare
the clip you intend to take, and every run tells you it is still outstanding.
