# Media provider arbitration and troubleshooting

This guide captures the live lessons behind `InputLocalhostMediaSource`. Its
purpose is to keep future media widgets from confusing an open app, a focused
window, a stale MediaRemote record, and the player that actually owns audible
playback.

## Ownership policy

Provider selection follows evidence of active playback, not application focus:

1. Preserve a direct provider result, such as Spotify or native Apple Music,
   when it already supplies a coherent track.
2. When Input reports generic `media_remote`, probe the absolute
   `/System/Applications/Music.app`. A playing Music track wins over stale
   Chrome or MediaRemote metadata.
3. Otherwise inspect the real `/Applications/Google Chrome.app`, scan all
   windows and tabs, and accept YouTube Music only when exactly one valid
   `music.youtube.com/watch?v=<11-character-id>` tab exists.
4. Resolve that video through bounded YouTube oEmbed and compare the watch-page
   duration with MediaRemote. A difference greater than five seconds is a
   transition, not a new authoritative snapshot.
5. If no specialized provider owns playback, retain the bounded generic
   MediaRemote result and use exact title-plus-artist matching for Apple catalog
   artwork.
6. On ambiguity or a transition mismatch, return transient inactivity. The
   session's eight-second grace retains the last accepted title, artist,
   artwork, and frozen position instead of publishing a queued or mixed track.

This precedence is intentional. Changing app focus alone does not switch the
widget; starting playback in the other player does.

## Source-of-truth matrix

| Data | Preferred source | Required validation |
| --- | --- | --- |
| Apple title, artist, duration, position | Absolute Music.app JXA | Music reports `playing` |
| YouTube title and author | YouTube oEmbed for the live tab video ID | Exactly one valid watch tab |
| YouTube transition identity | Watch-page duration plus MediaRemote duration | Difference at most 5,000 ms |
| Apple cover | Public Apple catalog | Exact normalized title and artist |
| YouTube cover | oEmbed thumbnail | HTTPS, bounded fetch and decode |
| Timeline | Selected provider | Clamp to duration; predict only within same track key |
| Device metadata | Complete accepted snapshot | Six fields on every `mp.write_info` call |
| Device artwork | 80x80 RGB565-LE | 12,800 bytes, five ordered chunks, atomic commit |

Every published snapshot records provenance such as `apple_music_jxa`,
`youtube-music-live-tab-oembed`, `apple-catalog-artwork`, or
`youtube-music-oembed-thumbnail`. Treat provenance as part of diagnostics, not
as decorative metadata.

## Browser rules that matter

- Target Chrome by its absolute application path. A generic application name
  can bind to a headless Chrome process instead of the user's browser.
- Scan all tabs. YouTube Music can keep playing from a background tab.
- Do not infer playback from browser history, a tab merely existing, or window
  focus.
- Fail closed if more than one valid YouTube Music watch tab is present.
- Do not execute page JavaScript. URL inspection, bounded oEmbed, and the
  duration check are sufficient for the supported contract.

## Apple Music rule that matters

Input's packaged Apple script can fail while reading raw artwork and then fall
through to generic MediaRemote, even though title and playback state are valid.
The SDK deliberately separates those concerns: JXA obtains metadata without
touching artwork, then the catalog resolver obtains the cover independently.

## Device-boundary rules

- Merge one-second field diffs into the last accepted six-field metadata
  snapshot before invoking `mp.write_info`.
- Advance the sink cache only after `{status:"ok"}`. A rejected write cannot
  become the next diff baseline.
- Send artwork only when the encoded RGB565 pixel hash changes.
- On a rejected or interrupted artwork transaction, clear the host `inflight`
  state so the exact track can retry.
- Preserve the exact chunk geometry: `3072, 3072, 3072, 3072, 512` bytes.
- Never mix metadata from one provider with artwork from another provider.

## Troubleshooting

| Symptom | First check | Expected fix or interpretation |
| --- | --- | --- |
| Widget shows the queued next song | Inspect provider provenance and durations | Treat a duration mismatch as transient inactivity |
| Widget stays on Chrome after switching to Music | Confirm Music is actually playing and provider is `apple_music_jxa` | Focus alone is not an ownership signal |
| Wrong Chrome title or author | Count valid YouTube Music watch tabs | Require exactly one tab and use oEmbed identity |
| Blue/generated art instead of the cover | Inspect `artworkSource` | Fix host artwork resolution; the renderer is receiving fallback pixels |
| Time advances but strings remain stale | Inspect the sink's accepted full snapshot | Merge partial diffs before every device RPC |
| Cover never retries after one failure | Inspect artwork `inflight` state | Abort and clear the transaction on reject or throw |
| Track disappears briefly during handoff | Inspect `lastProbeStatus.reason` | `youtube-transition-duration-mismatch` should use the grace window |
| Switching focused apps does nothing | Check which player is playing audio | This is expected behavior |

## Fast inspection

The read-only command reports the selected provider and artwork provenance
without opening the keyboard:

```sh
node f1-widget-sdk/bin/f1-widget.mjs media inspect
```

For the accepted Framer F1 app, run one deterministic publish:

```sh
cd f1-widget-sdk
npm run media:live -- --confirm-live-rpc --once
```

Use the continuous runner only after inspection identifies the intended track:

```sh
npm run media:live -- --confirm-live-rpc
```

The live proof, payload bounds, and artwork transaction details remain in
[`media-transport.md`](media-transport.md). The on-device handler and memory
contract remain in [`music-id1-media-rpc.md`](music-id1-media-rpc.md).
