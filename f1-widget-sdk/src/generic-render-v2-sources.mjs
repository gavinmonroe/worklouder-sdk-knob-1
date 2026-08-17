import { assert } from "./util.mjs";

const CAPABILITY_STRINGS = Object.freeze([
  ["protocol_key", "protocol", 16],
  ["protocol_value", "framer-widget-scene-rpc-v1", 28],
  ["profile_key", "renderV2Profile", 56],
  ["profile_value", "framer-f1-render-v2-structural-v1", 72],
  ["format_key", "packageFormat", 108],
  ["format_value", "framer-render-v2-package-v1", 124],
  ["max_bundle_key", "maxBundleBytes", 152],
  ["max_bundle_value", "98304", 168],
  ["chunk_raw_key", "chunkRawBytes", 176],
  ["chunk_raw_value", "3072", 192],
  ["max_chunks_key", "maxChunks", 200],
  ["max_chunks_value", "32", 212],
  ["generation_key", "committedGeneration", 216],
]);

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

function stackStores(label, value, offset) {
  const bytes = paddedString(value);
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    `    l32r    a8,.Lcap_${label}_${index}\n` +
    `    s32i    a8,a1,${offset + index * 4}`).join("\n");
}

function field(keyOffset, valueOffset) {
  return `    addi    a10,a1,248
    addi    a11,a1,256
    addi    a12,a1,${keyOffset}
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,248
    addi    a11,a1,${valueOffset}
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8`;
}

const CAPABILITY_HANDLER = `${CAPABILITY_STRINGS.map(([label, value, offset]) =>
  stackStores(label, value, offset)).join("\n")}
    /* Request root retains the accepted callback/request lifetime. */
    addi    a10,a1,320
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    /* Canonical u32 decimal occupies stack +236..+246 plus NUL. */
    l32i    a10,a7,8
    addi    a11,a1,236
    call8   renderer_scene_rpc_u32_decimal
    beqz    a10,.Lscene_cap_return_request
    /* Response root at +256; proxy scratch at +248. */
    l32r    a8,.Lscene_json_allocator
    s32i    a8,a1,256
    movi.n  a9,0
    s8i     a9,a1,260
    s32i    a9,a1,264
    addi    a8,a1,268
    s32i    a8,a1,300
    s16i    a9,a1,304
    movi.n  a8,4
    s16i    a8,a1,306
    movi.n  a8,-1
    s16i    a8,a1,308
    s8i     a9,a1,316
    s16i    a8,a1,318
    /* status/ok are persistent RAM substrings in the accepted scene state. */
    addi    a10,a1,248
    addi    a11,a1,256
    addi    a12,a7,313
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,248
    addi    a11,a7,200
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
${field(16, 28)}
${field(56, 72)}
${field(108, 124)}
${field(152, 168)}
${field(176, 192)}
${field(200, 212)}
${field(216, 236)}
    mov     a10,a6
    mov     a11,a5
    addi    a12,a1,256
    l32r    a8,.Lscene_rpc_respond
    callx8  a8
    addi    a10,a1,256
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_cap_return_request:
    addi    a10,a1,320
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8`;

export function genericSceneRpcAssembly(rawSource) {
  let source = rawSource;
  for (const symbol of ["renderer_scene_rpc_register_one", "renderer_scene_rpc_read_integer",
    "renderer_scene_rpc_reply_status", "renderer_scene_rpc_make_root"]) {
    source = source.replace(`    .type ${symbol},@function`,
      `    .global ${symbol}\n    .type ${symbol},@function`);
  }
  const capabilityLiterals = CAPABILITY_STRINGS.map(([label, value]) =>
    literalWords(label, value)).join("\n");
  const firstText = `    .section .text.renderer_scene_rpc,"ax",@progbits`;
  assert(source.includes(firstText), "Scene RPC source lost its first text section.");
  source = source.replace(firstText, `${capabilityLiterals}\n\n${firstText}`);
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
  assert(!source.includes(marker) &&
    source.includes("renderer_scene_rpc_u32_decimal") &&
    source.includes(".Lcap_generation_key_0"),
  "Generic capability response transformation did not complete.");
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
