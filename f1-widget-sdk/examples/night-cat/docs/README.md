# Widget development record

## Immutable descriptor order

`sky-0, sky-1, then species * 8 + state`.

Roster: Belgian Tervuren, Pepe, Angry owl, Cute ferret, Cat, Lazy cow.

States: ready, curious, happy, zooming, fire, tired, waiting, sleeping.

Input: on screen ID 7, Fn + bottom encoder; clockwise next, counterclockwise previous; selection wraps and remains in controller RAM only.

## Known live regression

Stage-3E.2 pets rendered as white squares and twinkle switching corrupted the
lower screen. The sky-1 payload crosses virtual DROM page `0x3c1d0000` and pet
payloads start beyond it; this is a correlation, not a proven cause.

## Findings

Record runtime observations here; do not silently turn observations into ABI facts.
