# Test record

## Offline

- [ ] `validate` passes.
- [ ] The backgrounds are exactly 100x310.
- [ ] Descriptor order is sky0, sky1, species*8+state.
- [ ] DROM growth equals ceil(bank/0x10000)*0x10000.
- [ ] Runtime image status is `UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE`.
- [ ] `liveVisualApproved` remains false until a controlled fix is proven.
- [ ] `build` is deterministic.
- [ ] Stock key callback, WPM tick, and Timer getter remain preserved.
- [ ] Manifest lists only one patched word plus DROM/IROM appends.

## Independent hardware handoff

Do not promote the current image output while the known regression is open.
This SDK does not authorize or perform deployment. Record recovery verification,
independent ABI/image audit, exact output hash, readback hash, boot result,
visual result, and rollback result in the workspace recovery workflow.
