# Exact SDK gaps exposed by music playback

The current guarded compiler is intentionally WPM-specific. The music proof must not bypass those checks. At the time this example was authored, these constraints prevent a safe firmware build:

1. `profile` is restricted to `wpm-roster-v2`; there is no `host-fed-media-v1` schema or code generator.
2. Assets require exactly two full-canvas backgrounds plus one to fifteen species with exactly eight WPM state frames each. A music widget instead needs album art, a generated gradient, font/text policy, and a progress primitive.
3. State input is fixed to `native-wpm-float` and behavior to `semantic-wpm-idle-v1`. There is no reviewed host-fed state ABI.
4. Layout is an exact WPM roster object. It cannot describe album art, title, artist, elapsed/duration, or progress.
5. The asset bank is compile-time DROM. Rebuilding or reflashing it for each track/progress tick would be unsafe and operationally wrong.
6. The guarded assembly templates are tied to the proven WPM setup wrapper and static descriptor order. There is no dynamic media buffer ownership model.
7. No proven firmware RPC, filesystem namespace, generation manifest, UI-thread swap, or rollback semantics exist for media updates.
8. The real Input-localhost host adapter is implemented in this example, but it is not yet registered as a core SDK profile/provider and still depends on Input's packaged, hash-pinned macOS script.

## Recommended core changes

These should be added as independently reviewable features, not loosened WPM guards:

- Introduce a discriminated profile registry. Keep all existing `wpm-roster-v2` validation exact; add a separate `host-fed-media-v1` validator and builder.
- Separate reusable canvas/assets/layout primitives from profile-specific state machines.
- Add deterministic decoded-RGBA ingestion, resizing, palette extraction, text bounding, progress rendering, and explicit RAM/DROM/storage budgets.
- Define a versioned host-state ABI with maximum message/file sizes, monotonic generation, checksums, replay handling, timeouts, and stale-media fallback.
- Prove and pin a bounded device transport before exposing any publishing CLI. Hardware-free `package` and `inspect-media-bundle` commands can land first.
- Keep firmware building and device publishing separate. A media bundle must never be accepted as an app image.
- Add a simulator/preview target using the exact logical `100x310` orientation and a fixture adapter.
- Keep the existing hardware-free host bridge tests for missing art, provider disappearance, bounded decode, generation acceptance, and the blocked Framer sink. Add device-side failure injection for interrupted staging, stale generation, corrupt asset, and teardown only after a Framer handler exists.

Until these exist and the device-side ABI is proven, this example should remain a host-side contract/preview test only.

## Combined-firmware integration status

SDK v0.3 now produces the deterministic combined Music ID1 plus WPM ID7 app.
The completed, enforced parts are:

- one setup wrapper that calls stock setup exactly once, resolves shared
  registry/navigation context, and invokes Music then WPM registration;
- frozen `stage3e34_register_wpm(a2=registry, a3=navigation)` and Music ID1
  registration modules, each gating navigation on `controller+20 == registry`;
- one combined appended-IROM link with zero relocations and repeated
  deterministic output;
- screen-ID uniqueness (`1` Music, `7` WPM, stock-occupied `8` prohibited);
- the hard `<0x3C1D0000` runtime DROM rule, with Music contributing zero DROM;
- exact base, recovery, segment/MMU, checksum/digest, stock-hook, image-info,
  and output-hash gates.

The remaining device validation is runtime evidence: Music must appear in
navigation, both screens must survive repeated enter/leave cycles, and heap
availability must be measured for the Music controller's 8,424-byte allocation.
The first exact app-only write and boot-health smoke passed; a fresh builder
approval draft remains false by default and does not inherit that authorization.

The current music ABI uses provisional address `0x42118000` only for offline relocation and determinism checks. The combined linker must own its final address; copying the provisional bytes into an arbitrary app address is forbidden.
