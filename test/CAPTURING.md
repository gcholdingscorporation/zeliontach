# Capturing real audio for the test matrix

Everything in `matrix/synthetic.json` is a signal this project generated itself.
It can only ever confirm that the detector still behaves the way it behaved
yesterday. It cannot tell you whether the detector works, because the thing it
is built to survive — real wind over a real microphone, a real rotor at a real
distance, real background — is exactly what a generator does not produce.

This file is the part a person has to do.

## What you need per capture

**1. Audio.** Record with the phone you actually care about, using the phone's
own voice-recorder app, and do not trim, normalise or noise-reduce it
afterwards. Whatever the recorder does to the signal is part of what the
detector has to cope with, so leave it in. Ten to thirty seconds is plenty; a
minute is better if the head speed is changing.

**2. Ground truth — a head speed you measured, not one you assumed.** This is
the whole value of the capture and the easiest thing to get wrong. In order of
preference:

- An optical or laser tachometer on the rotor, read during the take.
- The aircraft's own tachometer, filmed in the same take so the timecodes line
  up. Note the reading and the second it was taken.
- A governed head speed with the governor confirmed engaged and in the green.
  Weaker — it is the nominal figure, not a measurement — so say so in the
  manifest and expect a wider tolerance.

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

The phone's original file goes in as-is — `.m4a` is fine and is what a phone
produces. The harness converts it to WAV once with ffmpeg and ignores the
conversion from then on.

Leave `expect` off a brand-new capture if you do not yet know what is
reasonable to ask of it. Run it, look at what the detector actually does, and
then write down a bar. A bar invented before the first run is a guess wearing a
number.

## When you have no audio yet

A case with an `audio` path that is not in the tree reports `awaiting audio` and
does not fail the run. So the matrix doubles as the capture checklist: declare
the clip you intend to take, and every run tells you it is still outstanding.
