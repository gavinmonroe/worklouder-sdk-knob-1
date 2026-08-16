# Music ID1 live crash and containment

## Evidence

The first combined Music ID1 plus WPM ID7 app booted normally, and WPM ID7 was
user-accepted as visually complete. Entering/leaving Music ID1 then reproduced
a keyboard crash and watchdog reboot.

The read-only post-crash coredump is preserved at
`artifacts/coredumps/framer-combined-music-id1-crash-2026-08-15.bin`:

- bytes: 65,536;
- SHA-256: `d3f95812f40d0f05eee0b76dba6ac767b632d61bd6cf9441ec60856f87bd76fa`;
- valid Xtensa ELF core begins at file offset 24;
- crashing task: `wl_lvgl`, TCB `0x3FCCCC74`;
- panic: `assert failed: multi_heap_free multi_heap_poisoning.c:279 (head != NULL)`;
- captured stack/register evidence reaches LVGL object/style teardown near
  `0x4209F813` and child-removal code near `0x420A11B3`.

This proves an invalid/double-free condition in the Music LVGL teardown path.
It does not, by itself, prove which child first corrupted the ownership state.

## Narrowed Music-only surface

The live-complete WPM screen already proves a large controller allocation,
controller-owned image descriptor/pixels, ordinary labels, common 100-ms timer
lifecycle, and borrowed-pointer cleanup on this firmware. Music's unique
teardown surface was nine label objects repurposed as sized, opaque, rounded
background/progress panels.

The containment patch leaves that experimental panel helper linked for address
stability but makes every call site unreachable. Music creates only:

1. a flat painted root;
2. one 64x64 controller-RAM RGB565 image;
3. title, artist, and elapsed/duration text labels.

`music_id1_cleanup` only clears four borrowed pointers and contains no call or
free instruction. Root teardown remains the sole LVGL child owner.

## WPM freeze gate

The containment is Music-only. Every combined build now fails closed unless it
preserves these live-complete WPM bytes:

- registration-only ABI: 1,928 bytes, SHA-256
  `6862764da34424285799e5c91796cd6080fca1adc1374f60f5b171b8d34c6c12`;
- linked WPM literals: 220 bytes, SHA-256
  `c447cf2300462ad218ab7d687595a5f178c06f0ca9ee5b4adadd2c3d65d24646`;
- linked WPM text: 1,708 bytes, SHA-256
  `4934ea5a2ec030cb689953d813d0995854d911546b4d4ebd122014bf4b49ec0c`;
- asset page: SHA-256
  `c49880fdc1fa2f8d34fa08d989c09d8e23b9546243b0db32bb8f1bca8741fee5`.

## Containment artifact

The contained mock image was built only for static verification and must not
be reflashed. The next device candidate will include the real Input media RPC
path rather than another mock-only test.

- app bytes: 2,029,088;
- app SHA-256:
  `3bee0ae9ed339cef08ea7198e946d1feabb9c54067787af2ec278544df55c9a1`;
- combined code bytes: 3,048;
- combined code SHA-256:
  `d5a9bd2a9a84f769b34eee582a6137d6ce1e620414152cf90a2db9a06bc3b88c`;
- checksum: `0xDC`;
- appended digest:
  `aabc84a3b77f615f6be740f71c7908b2b2cadc4c74a0ad69576d138cf1fd5260`.

Focused Music/combined tests pass 8/8. A future live candidate should exercise
at least 20 Music enter/wait/leave cycles, verify no new coredump hash, and then
repeat with track changes and artwork updates. Boot health alone is not runtime
acceptance.
