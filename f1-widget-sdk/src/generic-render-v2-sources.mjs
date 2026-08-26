import { assert } from "./util.mjs";

// ── Persistent capability storage ────────────────────────────────────────────
//
// The stock JSON layer stores POINTERS and serializes the response after the
// handler's frame is gone. The one field that always worked says why, in the
// handler's own words:
//
//   /* status/ok are persistent RAM substrings in the accepted scene state. */
//
// status/ok are read from state+192/+200/+313 — persistent RAM. Every other
// capability field built its key and value on the stack, so by serialization
// time they were dangling pointers. That is the crash (LoadProhibited,
// EXCVADDR 6), and it is exactly what device-workflow.mjs blacklists:
// "the protocol and v1Packages fields reuse borrowed stack-backed JSON
// key/value storage". Two earlier attempts failed because they treated the
// word "reuse" as the defect; the operative word is "stack-backed".
//
// Fix: give every key and value persistent storage. The scene RPC allocation
// grows 98_624 -> 99_136, keeping store[98_304] at its pinned +320 offset and
// adding a 512-byte region at the tail. init_strings writes the table there
// once, at registration.
//
// Growing is safe to attempt: renderer_scene_rpc_register null-checks
// operator new and jumps to .Lscene_register_fail (returns 0), so an
// allocation failure means the scene RPC simply does not register — visible
// immediately because widget.scene.status stops answering, and recoverable by
// reflashing. It is not a crash and not a brick.
const SCENE_ALLOCATION_BYTES = 99_136;
const PERSIST_BASE = 98_624;
const PERSIST_CAPACITY = SCENE_ALLOCATION_BYTES - PERSIST_BASE;

// [label, value, offset-within-persistent-region]
const CAPABILITY_STRINGS = Object.freeze([
  ["protocol_key", "protocol", 0],
  ["protocol_value", "framer-widget-scene-rpc-v1", 12],
  ["profile_key", "renderV2Profile", 40],
  ["profile_value", "framer-f1-render-v2-structural-v1", 56],
  ["format_key", "packageFormat", 92],
  ["format_value", "framer-render-v2-package-v1", 108],
  ["bundle_key", "maxBundleBytes", 136],
  ["bundle_value", "98304", 152],
  ["chunk_key", "chunkRawBytes", 160],
  ["chunk_value", "3072", 176],
  ["chunks_key", "maxChunks", 184],
  ["chunks_value", "32", 196],
  ["generation_key", "committedGeneration", 200],
  ["code_key", "code", 220],
]);

/** Scratch that is written per-call, not part of the constant table. */
const PERSIST_GENERATION_DECIMAL = 228; // 11 digits + NUL
const PERSIST_CODE_DECIMAL = 240;       // 11 digits + NUL
const PERSIST_USED = 252;

function paddedString(value) {
  const raw = Buffer.from(`${value}\0`, "ascii");
  const padded = Buffer.alloc((raw.length + 3) & ~3);
  raw.copy(padded);
  return padded;
}

function literalWords(label, value) {
  const bytes = paddedString(value);
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    `.Lcap_${label}_${index}: .long 0x${bytes.readUInt32LE(index * 4)
      .toString(16).padStart(8, "0")}`).join("\n");
}

/**
 * Absolute offsets exceed addi's -128..127 immediate, so every pointer into the
 * persistent region is materialised through an l32r literal plus add.
 */
function persistPointerLiterals() {
  const entries = [
    ...CAPABILITY_STRINGS.map(([label, , offset]) => [label, offset]),
    ["generation_decimal", PERSIST_GENERATION_DECIMAL],
    ["code_decimal", PERSIST_CODE_DECIMAL],
  ];
  return entries.map(([label, offset]) =>
    `.Lcapoff_${label}: .long ${PERSIST_BASE + offset}`).join("\n");
}

/** a<dst> = state(a<state>) + persistent offset of `label`. */
function persistPointer(dst, stateReg, label) {
  return `    l32r    a8,.Lcapoff_${label}\n    add     a${dst},a${stateReg},a8`;
}

/**
 * Written once at registration. s32i's offset field reaches 0..1020 from a
 * base register, and the region is 512 bytes, so a single base suffices.
 */
const PERSIST_INIT = `    l32r    a8,.Lcapoff_protocol_key
    add     a7,a2,a8
${CAPABILITY_STRINGS.map(([label, value, offset]) => {
  const bytes = paddedString(value);
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    `    l32r    a8,.Lcap_${label}_${index}\n` +
    `    s32i    a8,a7,${offset + index * 4}`).join("\n");
}).join("\n")}
    memw`;

// With every string now in persistent RAM, the frame holds only the proxy and
// the two roots. That also retires the old layout's zero-slack problem: the
// request root ends at +160 in a 384-byte frame.
const CAP_PROXY = 16;
const CAP_RESPONSE_ROOT = 32;
const CAP_REQUEST_ROOT = 96;

/** One JSON field, both pointers resolved into the persistent region. */
function field(keyLabel, valueLabel) {
  return `    addi    a10,a1,${CAP_PROXY}
    addi    a11,a1,${CAP_RESPONSE_ROOT}
${persistPointer(12, 7, keyLabel)}
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,${CAP_PROXY}
${persistPointer(11, 7, valueLabel)}
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8`;
}

const CAPABILITY_HANDLER = `    /* Request root retains the accepted callback/request lifetime. */
    addi    a10,a1,${CAP_REQUEST_ROOT}
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    /* committedGeneration -> canonical decimal in persistent RAM. */
    l32i    a10,a7,8
${persistPointer(11, 7, "generation_decimal")}
    call8   renderer_scene_rpc_u32_decimal
    beqz    a10,.Lscene_cap_return_request
    addi    a4,a1,${CAP_RESPONSE_ROOT}
    l32r    a8,.Lscene_json_allocator
    s32i    a8,a4,0
    movi.n  a9,0
    s8i     a9,a4,4
    s32i    a9,a4,8
    addi    a8,a4,12
    s32i    a8,a4,44
    s16i    a9,a4,48
    movi.n  a8,4
    s16i    a8,a4,50
    movi.n  a8,-1
    s16i    a8,a4,52
    s8i     a9,a4,60
    s16i    a8,a4,62
    /* status/ok: already persistent substrings of the scene state. */
    addi    a10,a1,${CAP_PROXY}
    addi    a11,a1,${CAP_RESPONSE_ROOT}
    addi    a12,a7,313
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,${CAP_PROXY}
    addi    a11,a7,200
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
${field("protocol_key", "protocol_value")}
${field("profile_key", "profile_value")}
${field("format_key", "format_value")}
${field("bundle_key", "bundle_value")}
${field("chunk_key", "chunk_value")}
${field("chunks_key", "chunks_value")}
${field("generation_key", "generation_decimal")}
    mov     a10,a6
    mov     a11,a5
    addi    a12,a1,${CAP_RESPONSE_ROOT}
    l32r    a8,.Lscene_rpc_respond
    callx8  a8
    addi    a10,a1,${CAP_RESPONSE_ROOT}
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_cap_return_request:
    addi    a10,a1,${CAP_REQUEST_ROOT}
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8`;

// ── Status-code diagnostics ──────────────────────────────────────────────────
//
// Handlers flattened every core return value to a boolean, so BUSY,
// GENERATION, RANGE and PARAMS all reached the host as the same bare
// {"status":"error"}. reply_status now carries the code, using the SAME
// persistent storage rule as everything else: the "code" key and its decimal
// live in the persistent region, never on the stack. Codes are negated so the
// wire value is a small positive integer (BUSY=1, PARAMS=2, GENERATION=3,
// RANGE=4, ORDER=5, SHA=6, TORN=7, F1WB=8, STAGE=9, V2=10; REJECTED=0).
const REPLY_CODE_BLOCK = `    bnei    a3,1,.Lscene_reply_emit_code
    j       .Lscene_reply_code_done
.Lscene_reply_emit_code:
    neg     a10,a3
${persistPointer(11, 2, "code_decimal")}
    call8   renderer_scene_rpc_u32_decimal
    beqz    a10,.Lscene_reply_code_done
    mov     a10,a1
    addi    a11,a1,16
${persistPointer(12, 2, "code_key")}
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    mov     a10,a1
${persistPointer(11, 2, "code_decimal")}
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
.Lscene_reply_code_done:`;

export function genericSceneRpcAssembly(rawSource) {
  let source = rawSource;
  for (const symbol of ["renderer_scene_rpc_register_one", "renderer_scene_rpc_read_integer",
    "renderer_scene_rpc_reply_status", "renderer_scene_rpc_make_root"]) {
    source = source.replace(`    .type ${symbol},@function`,
      `    .global ${symbol}\n    .type ${symbol},@function`);
  }

  // Grow the scene RPC allocation to carry the persistent string region.
  const allocation = "    .long 98624";
  assert(source.includes(`.Lscene_allocation_bytes:      ${allocation.trim()}`) ||
    source.includes(".Lscene_allocation_bytes:      .long 98624"),
  "Scene allocation literal changed shape.");
  source = source.replace(".Lscene_allocation_bytes:      .long 98624",
    `.Lscene_allocation_bytes:      .long ${SCENE_ALLOCATION_BYTES}`);

  const literals = `${[...CAPABILITY_STRINGS].map(([label, value]) =>
    literalWords(label, value)).join("\n")}\n${persistPointerLiterals()}`;
  const firstText = `    .section .text.renderer_scene_rpc,"ax",@progbits`;
  assert(source.includes(firstText), "Scene RPC source lost its first text section.");
  source = source.replace(firstText, `${literals}\n\n${firstText}`);

  // Populate the persistent table once, at registration, alongside the method
  // strings init_strings already writes.
  const initTail = `    l32r    a8,.Lr_ok
    s32i    a8,a7,8
    memw
    retw.n`;
  assert(source.includes(initTail), "init_strings tail changed shape.");
  source = source.replace(initTail, `    l32r    a8,.Lr_ok
    s32i    a8,a7,8
${PERSIST_INIT}
    retw.n`);

  const marker = "SCENE_SIMPLE_HANDLER renderer_scene_rpc_handle_capabilities";
  assert(source.includes(marker), "Scene RPC capabilities handler marker changed.");
  source = source.replace(marker, `.balign 4
    .global renderer_scene_rpc_handle_capabilities
    .type renderer_scene_rpc_handle_capabilities,@function
renderer_scene_rpc_handle_capabilities:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lscene_cap_return
    beqz    a6,.Lscene_cap_return
    beqz    a5,.Lscene_cap_return
${CAPABILITY_HANDLER}
.Lscene_cap_return:
    retw.n
    .size renderer_scene_rpc_handle_capabilities,.-renderer_scene_rpc_handle_capabilities`);

  source = withStatusCodes(source);

  assert(!source.includes(marker) &&
    source.includes("renderer_scene_rpc_u32_decimal") &&
    source.includes(".Lcapoff_generation_key") &&
    source.includes(".Lscene_reply_emit_code") &&
    source.includes(`.long ${SCENE_ALLOCATION_BYTES}`),
  "Generic capability response transformation did not complete.");
  return source;
}

/**
 * reply_status(arg2) becomes the core status code rather than a boolean, and a
 * "code" field is appended on failure. The state arrives in a5 but is
 * immediately consumed to select the ok/error substring, so it is preserved
 * into a2 first -- a2 is free once arg0 has been copied to a7.
 */
function withStatusCodes(source) {
  const preserve = `renderer_scene_rpc_reply_status:
    entry   a1,112
    mov     a7,a2`;
  assert(source.includes(preserve), "reply_status prologue changed shape.");
  source = source.replace(preserve, `${preserve}
    mov     a2,a5                     /* keep the state; a5 is about to move */`);

  const okSelect = `    beqz    a3,.Lscene_reply_value_ready
    addi    a5,a5,8                   /* persistent "ok" */`;
  assert(source.includes(okSelect), "reply_status ok/error selection changed shape.");
  source = source.replace(okSelect,
    `    bnei    a3,1,.Lscene_reply_value_ready
    addi    a5,a5,8                   /* persistent "ok" (code 1) */`);

  const respond = `    mov     a10,a7
    mov     a11,a6
    addi    a12,a1,16
    l32r    a8,.Lscene_rpc_respond`;
  assert(source.includes(respond), "reply_status respond sequence changed shape.");
  source = source.replace(respond, `${REPLY_CODE_BLOCK}\n${respond}`);

  const flatten = /    movi\.n  a12,0\n    movi\.n  a8,1\n    bne     a10,a8,(\.\w+)\n    movi\.n  a12,1\n    j       \1\n/gu;
  assert((source.match(flatten) || []).length > 0, "No handler boolean-flattening sites found.");
  source = source.replace(flatten, (_m, label) => `    mov     a12,a10\n    j       ${label}\n`);
  return source;
}

export function genericEventRpcAssembly(rawSource) {
  let source = rawSource
    .replace(".Lrv2_scene_register_one:        .long 0x4211f660",
      ".Lrv2_scene_register_one:        .long renderer_scene_rpc_register_one")
    .replace(".Lrv2_scene_make_root:           .long 0x4211f960",
      ".Lrv2_scene_make_root:           .long renderer_scene_rpc_make_root")
    .replace(".Lrv2_scene_read_integer:        .long 0x4211f8c4",
      ".Lrv2_scene_read_integer:        .long renderer_scene_rpc_read_integer")
    .replace(".Lrv2_scene_reply_status:        .long 0x4211f8f0",
      ".Lrv2_scene_reply_status:        .long renderer_scene_rpc_reply_status");
  const fixedGate = `    l32r    a8,.Lrv2_expected_id
    bne     a10,a8,.Lrv2_event_error`;
  assert(source.includes(fixedGate), "Render-v2 event RPC fixed-ID gate changed.");
  source = source.replace(fixedGate, `    beqz    a10,.Lrv2_event_error
    srli    a8,a10,16
    bnez    a8,.Lrv2_event_error`);
  source = source.replace(".Lrv2_expected_id:               .long 0x0000b201\n", "");
  assert(!/\.Lrv2_scene_(?:register_one|make_root|read_integer|reply_status):\s+\.long 0x4211/iu
    .test(source) && !source.includes(".Lrv2_expected_id") &&
    /srli\s+a8,a10,16/u.test(source),
  "Generic event RPC retained a stale helper or fixed host ID.");
  return source;
}

export function genericIntegrationChain(wpmRegisterAddress) {
  return `.section .literal.renderer_v2_chain,"a",@progbits
.balign 4
.Lwpm_register: .long 0x${wpmRegisterAddress.toString(16)}
.section .text.renderer_v2_chain,"ax",@progbits
.balign 4
.global renderer_v2_combined_registration_chain
.type renderer_v2_combined_registration_chain,@function
renderer_v2_combined_registration_chain:
 entry a1,64
 mov a4,a2
 mov a5,a3
 mov a10,a4
 mov a11,a5
 l32r a8,.Lwpm_register
 callx8 a8
 mov a10,a4
 mov a11,a5
 call8 renderer_v1_register_id26
 beqz a10,.Lgeneric_chain_done
 mov a6,a10
 mov a10,a4
 mov a11,a5
 mov a12,a6
 movi.n a13,0
 movi.n a14,0
 call8 renderer_v2_native_attach
 beqz a10,.Lgeneric_chain_done
 mov a10,a6
 call8 renderer_scene_rpc_register
 beqz a10,.Lgeneric_chain_done
 mov a11,a10
 mov a10,a6
 call8 renderer_v2_rpc_register
.Lgeneric_chain_done:
 retw.n
.size renderer_v2_combined_registration_chain,.-renderer_v2_combined_registration_chain
`;
}

export function genericLinker(baseAddress) {
  return `ENTRY(renderer_v2_combined_registration_chain)
SECTIONS {
  . = 0x${baseAddress.toString(16)};
  .renderer_v2 : ALIGN(4) {
    KEEP(*(.literal.renderer_v2_chain))
    *(.literal)
    *(.literal.*)
    KEEP(*(.text.renderer_v2_chain))
    KEEP(*(.text.renderer_v1))
    KEEP(*(.text.renderer_scene_rpc))
    KEEP(*(.text.renderer_v2))
    KEEP(*(.text.renderer_v2_native))
    KEEP(*(.text.renderer_v2_rpc))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
  }
  .renderer_v2_rodata : ALIGN(4) { *(.rodata) *(.rodata.*) }
  .renderer_v2_data : ALIGN(4) { *(.data) *(.data.*) *(.bss) *(.bss.*) }
  /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame) *(.eh_frame.*) }
}
ASSERT(SIZEOF(.renderer_v2_rodata) == 0, "generic renderer must not dereference IROM rodata")
ASSERT(SIZEOF(.renderer_v2_data) == 0, "generic renderer must not allocate static RAM")
`;
}
