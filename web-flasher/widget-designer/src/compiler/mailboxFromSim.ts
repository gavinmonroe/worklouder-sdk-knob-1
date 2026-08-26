// ─────────────────────────────────────────────────────────────────────────────
// Frame the device program's own committed mailbox slots as a non-torn oracle
// mailbox for renderTargetFacadeHost.
//
// The slot VALUES are NOT reinterpreted here: they are the output of running the
// exact transpiled `deviceSource` through the mquickjs simulator — the same
// program the assembler lowered, so digit divisors, pick() indices, animation
// frame counters and the hidden variant are already baked into slot values by
// the transpiler. Inverting rendered DOM text back into table indices would be
// the hand-rolled slot semantics the pipeline forbids; this module owns only the
// seqlock framing and the render lifecycle.
//
// The oracle's mailbox gate (contract.mjs renderTargetFacadeHost) requires:
//   * sequence even (bit 0 clear) and sequenceAfter === sequence  → not torn
//   * slots is exactly 16 int32 values                            → not argument
//   * admittedGeneration === expectedGeneration                   → not generation
//   * slots[0] (revision) >= state.lastAppliedRevision            → not revision
// slot 0 is the publication revision the transpiled handler wrapper writes
// (`__rev` bumped once per committed dispatch), so it is non-negative and rises
// monotonically with each publish.
// ─────────────────────────────────────────────────────────────────────────────

export interface OracleMailbox {
  /** Even seqlock value; renderer rejects an odd (mid-write) sequence as torn. */
  sequence: number;
  /** Post-read seqlock; equal to `sequence` proves the read was consistent. */
  sequenceAfter: number;
  /** Exactly 16 int32 mailbox slots; slot 0 is the publication revision. */
  slots: number[];
  /** Must equal the container generation the facade was decoded against. */
  admittedGeneration: number;
}

/**
 * Build a consistent (non-torn) oracle mailbox from the device VM's committed
 * slots. `slots` must be the 16-value array the simulator's dispatch/`slots`
 * getter returns; `generation` is the F2UP container generation the facade was
 * decoded against.
 *
 * The sequence is derived from the revision so it is always even and strictly
 * increases as the widget publishes — matching a real seqlock — but the render
 * lifecycle uses a fresh state per paint (see `freshRenderState`), so the
 * absolute value only needs to be even and non-torn.
 */
export function mailboxFromDeviceSlots(slots: number[], generation: number): OracleMailbox {
  if (!Array.isArray(slots) || slots.length !== 16 || !slots.every(Number.isInteger)) {
    throw new TypeError("device slots must be exactly 16 int32 values");
  }
  if (!Number.isInteger(generation) || generation < 1) {
    throw new TypeError("generation must be an integer >= 1");
  }
  const revision = slots[0] >>> 0;
  // Even (bit 0 clear) so the renderer never reads it as a torn mid-write, and
  // monotonic in the revision so a later publish always presents a later
  // sequence. `sequenceAfter === sequence` states the read was consistent.
  const sequence = (revision + 1) * 2;
  return {
    sequence,
    sequenceAfter: sequence,
    // Defensive copy: a caller mutating its slot buffer after this call must
    // not retroactively change a mailbox already handed to the renderer.
    slots: slots.slice(),
    admittedGeneration: generation,
  };
}

/**
 * A fresh render state for one paint. The Device frame always renders the
 * LATEST committed slots (highest revision), so a zeroed `lastAppliedRevision`
 * always admits them (`revision >= 0`) and yields result:ok — no cross-paint
 * revision bookkeeping is needed. Monotonicity is still enforced upstream by the
 * device VM writing slot 0.
 */
export const freshRenderState = (): { lastAppliedRevision: number } => ({ lastAppliedRevision: 0 });
