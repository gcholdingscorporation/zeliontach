# Recordings

Real captures live here, one file per case id, in whatever format the phone
produced — `.m4a` is normal and is what the harness expects to see.

The phone's original file is what goes in. Do not trim, normalise or
noise-reduce it first: whatever the recorder did to the signal is part of what
the detector has to survive, so it belongs in the test.

The harness converts a non-WAV file once with ffmpeg and writes
`<name>.converted.wav` next to it. Those conversions are ignored by git —
they are derived, and they are large.

If ffmpeg is not installed, convert by hand:

    ffmpeg -i recordings/some-case.m4a -ac 1 -c:a pcm_s16le recordings/some-case.converted.wav
