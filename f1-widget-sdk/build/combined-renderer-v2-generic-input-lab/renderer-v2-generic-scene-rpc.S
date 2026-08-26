/*
 * Framer F1 0.4.1 renderer-v1 scene RPC transport.
 *
 * Registration-only module: it does not call stock setup, add a screen, touch
 * LVGL, or own the renderer lifecycle.  renderer_scene_rpc_register receives
 * the already-admitted ID26 controller in a2.  The allocation deliberately
 * lives for the rest of the boot: callback copies retain its address and the
 * accepted single-upload contract never reclaims or replaces the scene store.
 *
 * The stock callback ABI is copied from the accepted Music ID1 implementation:
 *   callback +0  context
 *   callback +4  reserved zero
 *   callback +8  stock closure 0x4200465c
 *   callback +12 dispatch thunk
 * The temporary callback is destroyed with 0x42106ae4 after registration.
 *
 * State layout (all offsets are bytes):
 *   +0 controller, +4 flags, +8 generation, +12 expected generation
 *   +16 total bytes, +20 total chunks, +24 next chunk, +28 received bytes
 *   +32 transaction-id length, +36 transaction-id[40]
 *   +76 bundle SHA-256 ASCII[65], +144 header scratch[20]
 *   +164 method/key/status RAM strings, +320 F1WB store[98,304]
 * Flags: bit0 transaction active, bit1 upload committed (per-boot BUSY latch).
 */

    .section .literal.renderer_scene_rpc,"a",@progbits
    .balign 4
.Lscene_operator_new:          .long 0x420e7c04
.Lscene_rpc_registry:          .long 0x42004afc
.Lscene_rpc_register:          .long 0x420540f4
.Lscene_callback_destroy:      .long 0x42106ae4
.Lscene_callback_closure:      .long 0x4200465c
.Lscene_stage_bundle:          .long renderer_v1_stage_bundle
.Lscene_request_root_ctor:     .long 0x420576a4
.Lscene_json_lookup:           .long 0x42005560
.Lscene_json_string_tuple:     .long 0x420046e0
.Lscene_json_integer:          .long 0x42059638
.Lscene_json_response_key:     .long 0x42005240
.Lscene_json_assign_string:    .long 0x42005a18
.Lscene_json_root_dtor:        .long 0x42004f80
.Lscene_rpc_respond:           .long 0x42057d40
.Lscene_json_allocator:        .long 0x3fca4f34
.Lscene_allocation_bytes:      .long 99136
.Lscene_store_bytes:           .long 98304
.Lscene_chunk_bytes:           .long 3072
.Lscene_store_offset:          .long 320

/* Word literals only.  init writes every byte into ordinary RAM before any
 * stock routine sees it; no IROM label is ever used as a C-string pointer. */
.Lw_widget:                    .long 0x67646977 /* widg */
.Lw_dot_sce:                   .long 0x6563732e /* .sce */
.Lw_ne_c:                      .long 0x632e656e /* ne.c */
.Lw_ne_b:                      .long 0x622e656e /* ne.b */
.Lw_ne_w:                      .long 0x772e656e /* ne.w */
.Lw_ne_a:                      .long 0x612e656e /* ne.a */
.Lw_ne_s:                      .long 0x732e656e /* ne.s */
.Lw_apab:                      .long 0x62617061 /* apab */
.Lw_ilit:                      .long 0x74696c69 /* ilit */
.Lw_ies:                       .long 0x00736569 /* ies\0 */
.Lw_egin:                      .long 0x6e696765 /* egin */
.Lw_nul:                       .long 0x0000006e /* n\0 */
.Lw_writ:                      .long 0x74697277 /* writ */
.Lw_eul:                       .long 0x00000065 /* e\0 */
.Lw_comm:                      .long 0x6d6d6f63 /* comm */
.Lw_itul:                      .long 0x00007469 /* it\0 */
.Lw_abor:                      .long 0x726f6261 /* abor */
.Lw_tul:                       .long 0x00000074 /* t\0 */
.Lw_stat:                      .long 0x74617473 /* stat */
.Lw_usul:                      .long 0x00007375 /* us\0 */
.Lw_rite:                      .long 0x65746972 /* rite */
.Lw_ommi:                      .long 0x696d6d6f /* ommi */
.Lw_bort:                      .long 0x74726f62 /* bort */
.Lw_tatu:                      .long 0x75746174 /* tatu */
.Lw_sul:                       .long 0x00000073 /* s\0 */
.Lw_et_s2:                     .long 0x732e7465 /* et.s */
.Lw_cene:                      .long 0x656e6563 /* cene */
.Lw_dot_cap:                   .long 0x7061632e /* .cap */
.Lw_abil:                      .long 0x6c696261 /* abil */
.Lw_itie:                      .long 0x65697469 /* itie */
.Lw_dot_beg:                   .long 0x6765622e /* .beg */
.Lw_inul:                      .long 0x00006e69 /* in\0 */
.Lw_dot_wri:                   .long 0x6972772e /* .wri */
.Lw_teul:                      .long 0x00006574 /* te\0 */
.Lw_dot_com:                   .long 0x6d6f632e /* .com */
.Lw_mitul:                     .long 0x0074696d /* mit\0 */
.Lw_dot_abo:                   .long 0x6f62612e /* .abo */
.Lw_rtul:                      .long 0x00007472 /* rt\0 */
.Lw_dot_sta:                   .long 0x6174732e /* .sta */
.Lw_tusul:                     .long 0x00737574 /* tus\0 */

/* Request/reply words are copied to handler stack RAM before stock JSON sees
 * them.  These labels are integer literals only, never C-string pointers. */
.Lk_tx_0:                      .long 0x6e617274
.Lk_tx_1:                      .long 0x74636173
.Lk_tx_2:                      .long 0x496e6f69
.Lk_tx_3:                      .long 0x00000064
.Lk_expected_0:                .long 0x65707865
.Lk_expected_1:                .long 0x64657463
.Lk_expected_2:                .long 0x656e6547
.Lk_expected_3:                .long 0x69746172
.Lk_expected_4:                .long 0x00006e6f
.Lk_generation_0:              .long 0x656e6567
.Lk_generation_1:              .long 0x69746172
.Lk_generation_2:              .long 0x00006e6f
.Lk_total_bytes_0:             .long 0x61746f74
.Lk_total_bytes_1:             .long 0x7479426c
.Lk_total_bytes_2:             .long 0x00007365
.Lk_total_chunks_0:            .long 0x61746f74
.Lk_total_chunks_1:            .long 0x7568436c
.Lk_total_chunks_2:            .long 0x00736b6e
.Lk_chunk_raw_0:               .long 0x6e756863
.Lk_chunk_raw_1:               .long 0x7761526b
.Lk_chunk_raw_2:               .long 0x65747942
.Lk_chunk_raw_3:               .long 0x00000073
.Lk_sha_0:                     .long 0x32616873
.Lk_sha_1:                     .long 0x00003635
.Lk_index_0:                   .long 0x65646e69
.Lk_index_1:                   .long 0x00000078
.Lk_offset_0:                  .long 0x7366666f
.Lk_offset_1:                  .long 0x00007465
.Lk_bytes_0:                   .long 0x65747962
.Lk_bytes_1:                   .long 0x00000073
.Lk_chunk_sha_0:               .long 0x6e756863
.Lk_chunk_sha_1:               .long 0x6168536b
.Lk_chunk_sha_2:               .long 0x00363532
.Lk_data_0:                    .long 0x61746164
.Lk_data_1:                    .long 0x00000000
.Lr_status_0:                  .long 0x74617473
.Lr_status_1:                  .long 0x00007375
.Lr_ok:                        .long 0x00006b6f
.Lr_error_0:                   .long 0x6f727265
.Lr_error_1:                   .long 0x00000072

.Lcap_protocol_key_0: .long 0x746f7270
.Lcap_protocol_key_1: .long 0x6c6f636f
.Lcap_protocol_key_2: .long 0x00000000
.Lcap_protocol_value_0: .long 0x6d617266
.Lcap_protocol_value_1: .long 0x772d7265
.Lcap_protocol_value_2: .long 0x65676469
.Lcap_protocol_value_3: .long 0x63732d74
.Lcap_protocol_value_4: .long 0x2d656e65
.Lcap_protocol_value_5: .long 0x2d637072
.Lcap_protocol_value_6: .long 0x00003176
.Lcap_profile_key_0: .long 0x646e6572
.Lcap_profile_key_1: .long 0x32567265
.Lcap_profile_key_2: .long 0x666f7250
.Lcap_profile_key_3: .long 0x00656c69
.Lcap_profile_value_0: .long 0x6d617266
.Lcap_profile_value_1: .long 0x662d7265
.Lcap_profile_value_2: .long 0x65722d31
.Lcap_profile_value_3: .long 0x7265646e
.Lcap_profile_value_4: .long 0x2d32762d
.Lcap_profile_value_5: .long 0x75727473
.Lcap_profile_value_6: .long 0x72757463
.Lcap_profile_value_7: .long 0x762d6c61
.Lcap_profile_value_8: .long 0x00000031
.Lcap_format_key_0: .long 0x6b636170
.Lcap_format_key_1: .long 0x46656761
.Lcap_format_key_2: .long 0x616d726f
.Lcap_format_key_3: .long 0x00000074
.Lcap_format_value_0: .long 0x6d617266
.Lcap_format_value_1: .long 0x722d7265
.Lcap_format_value_2: .long 0x65646e65
.Lcap_format_value_3: .long 0x32762d72
.Lcap_format_value_4: .long 0x6361702d
.Lcap_format_value_5: .long 0x6567616b
.Lcap_format_value_6: .long 0x0031762d
.Lcap_bundle_key_0: .long 0x4278616d
.Lcap_bundle_key_1: .long 0x6c646e75
.Lcap_bundle_key_2: .long 0x74794265
.Lcap_bundle_key_3: .long 0x00007365
.Lcap_bundle_value_0: .long 0x30333839
.Lcap_bundle_value_1: .long 0x00000034
.Lcap_chunk_key_0: .long 0x6e756863
.Lcap_chunk_key_1: .long 0x7761526b
.Lcap_chunk_key_2: .long 0x65747942
.Lcap_chunk_key_3: .long 0x00000073
.Lcap_chunk_value_0: .long 0x32373033
.Lcap_chunk_value_1: .long 0x00000000
.Lcap_chunks_key_0: .long 0x4378616d
.Lcap_chunks_key_1: .long 0x6b6e7568
.Lcap_chunks_key_2: .long 0x00000073
.Lcap_chunks_value_0: .long 0x00003233
.Lcap_generation_key_0: .long 0x6d6d6f63
.Lcap_generation_key_1: .long 0x65747469
.Lcap_generation_key_2: .long 0x6e654764
.Lcap_generation_key_3: .long 0x74617265
.Lcap_generation_key_4: .long 0x006e6f69
.Lcap_code_key_0: .long 0x65646f63
.Lcap_code_key_1: .long 0x00000000
.Lcapoff_protocol_key: .long 98624
.Lcapoff_protocol_value: .long 98636
.Lcapoff_profile_key: .long 98664
.Lcapoff_profile_value: .long 98680
.Lcapoff_format_key: .long 98716
.Lcapoff_format_value: .long 98732
.Lcapoff_bundle_key: .long 98760
.Lcapoff_bundle_value: .long 98776
.Lcapoff_chunk_key: .long 98784
.Lcapoff_chunk_value: .long 98800
.Lcapoff_chunks_key: .long 98808
.Lcapoff_chunks_value: .long 98820
.Lcapoff_generation_key: .long 98824
.Lcapoff_code_key: .long 98844
.Lcapoff_generation_decimal: .long 98852
.Lcapoff_code_decimal: .long 98864

    .section .text.renderer_scene_rpc,"ax",@progbits
    .balign 4

/* a2=RAM destination. */
    .type renderer_scene_rpc_init_strings,@function
renderer_scene_rpc_init_strings:
    entry   a1,32
    addi    a7,a2,164
    /* Six fixed 40-byte slots make registration length/pointer unambiguous. */
    movi.n  a9,0
    movi    a10,156
.Lscene_zero_strings:
    s8i     a9,a7,0
    addi    a7,a7,1
    addi    a10,a10,-1
    bnez    a10,.Lscene_zero_strings
    addi    a7,a2,164
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    /* capabilities @ state+164, 25 bytes */
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_cap
    s32i    a8,a7,12
    l32r    a8,.Lw_abil
    s32i    a8,a7,16
    l32r    a8,.Lw_itie
    s32i    a8,a7,20
    l32r    a8,.Lw_sul
    s32i    a8,a7,24
    /* begin @ +204, 18 bytes */
    addi    a7,a2,204
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_beg
    s32i    a8,a7,12
    l32r    a8,.Lw_inul
    s32i    a8,a7,16
    /* write @ +228, 18 bytes */
    addi    a7,a2,228
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_wri
    s32i    a8,a7,12
    l32r    a8,.Lw_teul
    s32i    a8,a7,16
    /* commit @ +252, 19 bytes */
    addi    a7,a2,252
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_com
    s32i    a8,a7,12
    l32r    a8,.Lw_mitul
    s32i    a8,a7,16
    /* abort @ +276, 18 bytes */
    addi    a7,a2,276
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_abo
    s32i    a8,a7,12
    l32r    a8,.Lw_rtul
    s32i    a8,a7,16
    /* status @ +300, 19 bytes */
    addi    a7,a2,300
    l32r    a8,.Lw_widget
    s32i    a8,a7,0
    l32r    a8,.Lw_et_s2
    s32i    a8,a7,4
    l32r    a8,.Lw_cene
    s32i    a8,a7,8
    l32r    a8,.Lw_dot_sta
    s32i    a8,a7,12
    l32r    a8,.Lw_tusul
    s32i    a8,a7,16
    /* Persistent reply values occupy unused capability-slot slack. */
    addi    a7,a2,192
    l32r    a8,.Lr_error_0
    s32i    a8,a7,0
    l32r    a8,.Lr_error_1
    s32i    a8,a7,4
    l32r    a8,.Lr_ok
    s32i    a8,a7,8
    l32r    a8,.Lcapoff_protocol_key
    add     a7,a2,a8
    l32r    a8,.Lcap_protocol_key_0
    s32i    a8,a7,0
    l32r    a8,.Lcap_protocol_key_1
    s32i    a8,a7,4
    l32r    a8,.Lcap_protocol_key_2
    s32i    a8,a7,8
    l32r    a8,.Lcap_protocol_value_0
    s32i    a8,a7,12
    l32r    a8,.Lcap_protocol_value_1
    s32i    a8,a7,16
    l32r    a8,.Lcap_protocol_value_2
    s32i    a8,a7,20
    l32r    a8,.Lcap_protocol_value_3
    s32i    a8,a7,24
    l32r    a8,.Lcap_protocol_value_4
    s32i    a8,a7,28
    l32r    a8,.Lcap_protocol_value_5
    s32i    a8,a7,32
    l32r    a8,.Lcap_protocol_value_6
    s32i    a8,a7,36
    l32r    a8,.Lcap_profile_key_0
    s32i    a8,a7,40
    l32r    a8,.Lcap_profile_key_1
    s32i    a8,a7,44
    l32r    a8,.Lcap_profile_key_2
    s32i    a8,a7,48
    l32r    a8,.Lcap_profile_key_3
    s32i    a8,a7,52
    l32r    a8,.Lcap_profile_value_0
    s32i    a8,a7,56
    l32r    a8,.Lcap_profile_value_1
    s32i    a8,a7,60
    l32r    a8,.Lcap_profile_value_2
    s32i    a8,a7,64
    l32r    a8,.Lcap_profile_value_3
    s32i    a8,a7,68
    l32r    a8,.Lcap_profile_value_4
    s32i    a8,a7,72
    l32r    a8,.Lcap_profile_value_5
    s32i    a8,a7,76
    l32r    a8,.Lcap_profile_value_6
    s32i    a8,a7,80
    l32r    a8,.Lcap_profile_value_7
    s32i    a8,a7,84
    l32r    a8,.Lcap_profile_value_8
    s32i    a8,a7,88
    l32r    a8,.Lcap_format_key_0
    s32i    a8,a7,92
    l32r    a8,.Lcap_format_key_1
    s32i    a8,a7,96
    l32r    a8,.Lcap_format_key_2
    s32i    a8,a7,100
    l32r    a8,.Lcap_format_key_3
    s32i    a8,a7,104
    l32r    a8,.Lcap_format_value_0
    s32i    a8,a7,108
    l32r    a8,.Lcap_format_value_1
    s32i    a8,a7,112
    l32r    a8,.Lcap_format_value_2
    s32i    a8,a7,116
    l32r    a8,.Lcap_format_value_3
    s32i    a8,a7,120
    l32r    a8,.Lcap_format_value_4
    s32i    a8,a7,124
    l32r    a8,.Lcap_format_value_5
    s32i    a8,a7,128
    l32r    a8,.Lcap_format_value_6
    s32i    a8,a7,132
    l32r    a8,.Lcap_bundle_key_0
    s32i    a8,a7,136
    l32r    a8,.Lcap_bundle_key_1
    s32i    a8,a7,140
    l32r    a8,.Lcap_bundle_key_2
    s32i    a8,a7,144
    l32r    a8,.Lcap_bundle_key_3
    s32i    a8,a7,148
    l32r    a8,.Lcap_bundle_value_0
    s32i    a8,a7,152
    l32r    a8,.Lcap_bundle_value_1
    s32i    a8,a7,156
    l32r    a8,.Lcap_chunk_key_0
    s32i    a8,a7,160
    l32r    a8,.Lcap_chunk_key_1
    s32i    a8,a7,164
    l32r    a8,.Lcap_chunk_key_2
    s32i    a8,a7,168
    l32r    a8,.Lcap_chunk_key_3
    s32i    a8,a7,172
    l32r    a8,.Lcap_chunk_value_0
    s32i    a8,a7,176
    l32r    a8,.Lcap_chunk_value_1
    s32i    a8,a7,180
    l32r    a8,.Lcap_chunks_key_0
    s32i    a8,a7,184
    l32r    a8,.Lcap_chunks_key_1
    s32i    a8,a7,188
    l32r    a8,.Lcap_chunks_key_2
    s32i    a8,a7,192
    l32r    a8,.Lcap_chunks_value_0
    s32i    a8,a7,196
    l32r    a8,.Lcap_generation_key_0
    s32i    a8,a7,200
    l32r    a8,.Lcap_generation_key_1
    s32i    a8,a7,204
    l32r    a8,.Lcap_generation_key_2
    s32i    a8,a7,208
    l32r    a8,.Lcap_generation_key_3
    s32i    a8,a7,212
    l32r    a8,.Lcap_generation_key_4
    s32i    a8,a7,216
    l32r    a8,.Lcap_code_key_0
    s32i    a8,a7,220
    l32r    a8,.Lcap_code_key_1
    s32i    a8,a7,224
    memw
    retw.n
    .size renderer_scene_rpc_init_strings,.-renderer_scene_rpc_init_strings

/* Register one stock callback. a2=registry,a3=state,a4=method pointer,
 * a5=method byte length,a6=dispatch thunk. */
    .balign 4
    .global renderer_scene_rpc_register_one
    .type renderer_scene_rpc_register_one,@function
renderer_scene_rpc_register_one:
    entry   a1,64
    movi.n  a8,0
    s32i    a3,a1,16
    s32i    a8,a1,20
    l32r    a8,.Lscene_callback_closure
    s32i    a8,a1,24
    s32i    a6,a1,28
    mov     a10,a2
    mov     a11,a5
    mov     a12,a4
    addi    a13,a1,16
    l32r    a8,.Lscene_rpc_register
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lscene_callback_destroy
    callx8  a8
    retw.n
    .size renderer_scene_rpc_register_one,.-renderer_scene_rpc_register_one

/* a2=renderer ID26 controller. Returns a2=state or zero. */
    .balign 4
    .global renderer_scene_rpc_register
    .type renderer_scene_rpc_register,@function
renderer_scene_rpc_register:
    entry   a1,64
    beqz    a2,.Lscene_register_fail
    mov     a7,a2
    l32r    a10,.Lscene_allocation_bytes
    l32r    a8,.Lscene_operator_new
    callx8  a8
    mov     a6,a10
    beqz    a6,.Lscene_register_fail
    mov     a10,a6
    movi.n  a11,0
    l32r    a12,.Lscene_allocation_bytes
    /* Local byte clear avoids a new libc/firmware ABI dependency. */
.Lscene_clear:
    s8i     a11,a10,0
    addi    a10,a10,1
    addi    a12,a12,-1
    bnez    a12,.Lscene_clear
    s32i    a7,a6,0
    mov     a10,a6
    call8   renderer_scene_rpc_init_strings
    l32r    a8,.Lscene_rpc_registry
    callx8  a8
    mov     a5,a10
    beqz    a5,.Lscene_register_fail

    /* register(registry,state,method,length,thunk), six exact methods */
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,164
    movi.n  a13,25
    l32r    a14,.Lscene_cap_callback
    call8   renderer_scene_rpc_register_one
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,204
    movi.n  a13,18
    l32r    a14,.Lscene_begin_callback
    call8   renderer_scene_rpc_register_one
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,228
    movi.n  a13,18
    l32r    a14,.Lscene_write_callback
    call8   renderer_scene_rpc_register_one
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,252
    movi.n  a13,19
    l32r    a14,.Lscene_commit_callback
    call8   renderer_scene_rpc_register_one
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,276
    movi.n  a13,18
    l32r    a14,.Lscene_abort_callback
    call8   renderer_scene_rpc_register_one
    mov     a10,a5
    mov     a11,a6
    addi    a12,a6,300
    movi.n  a13,19
    l32r    a14,.Lscene_status_callback
    call8   renderer_scene_rpc_register_one
    mov     a2,a6
    retw.n
.Lscene_register_fail:
    movi.n  a2,0
    retw.n
    .size renderer_scene_rpc_register,.-renderer_scene_rpc_register

/* Stock dispatch thunk ABI: callback, response-holder, request.  Handlers use
 * a2=state,a3=response context,a4=request. */
    .macro SCENE_CALLBACK name, target
    .balign 4
    .global \name
    .type \name,@function
\name:
    entry   a1,32
    mov     a12,a4
    l32i.n  a11,a3,0
    l32i.n  a10,a2,0
    call8   \target
    retw.n
    .size \name,.-\name
    .endm

SCENE_CALLBACK renderer_scene_rpc_capabilities_callback, renderer_scene_rpc_handle_capabilities
SCENE_CALLBACK renderer_scene_rpc_begin_callback, renderer_scene_rpc_handle_begin
SCENE_CALLBACK renderer_scene_rpc_write_callback, renderer_scene_rpc_handle_write
SCENE_CALLBACK renderer_scene_rpc_commit_callback, renderer_scene_rpc_handle_commit
SCENE_CALLBACK renderer_scene_rpc_abort_callback, renderer_scene_rpc_handle_abort
SCENE_CALLBACK renderer_scene_rpc_status_callback, renderer_scene_rpc_handle_status

/* Literal pointers used by register live in the literal section because direct
 * callback label addresses are linker-resolved l32r values, never data reads. */
    .section .literal.renderer_scene_rpc,"a",@progbits
    .balign 4
.Lscene_cap_callback:           .long renderer_scene_rpc_capabilities_callback
.Lscene_begin_callback:         .long renderer_scene_rpc_begin_callback
.Lscene_write_callback:         .long renderer_scene_rpc_write_callback
.Lscene_commit_callback:        .long renderer_scene_rpc_commit_callback
.Lscene_abort_callback:         .long renderer_scene_rpc_abort_callback
.Lscene_status_callback:        .long renderer_scene_rpc_status_callback

    .section .text.renderer_scene_rpc,"ax",@progbits
    .balign 4

/* Build the request keys and reply strings in caller-owned stack RAM. */
    .type renderer_scene_rpc_init_keys,@function
renderer_scene_rpc_init_keys:
    entry   a1,32
    mov     a7,a2
    movi.n  a9,0
    movi    a10,160
.Lscene_keys_zero:
    s8i     a9,a7,0
    addi    a7,a7,1
    addi    a10,a10,-1
    bnez    a10,.Lscene_keys_zero
    mov     a7,a2
    l32r a8,.Lk_tx_0; s32i a8,a7,0
    l32r a8,.Lk_tx_1; s32i a8,a7,4
    l32r a8,.Lk_tx_2; s32i a8,a7,8
    l32r a8,.Lk_tx_3; s32i a8,a7,12
    l32r a8,.Lk_expected_0; s32i a8,a7,16
    l32r a8,.Lk_expected_1; s32i a8,a7,20
    l32r a8,.Lk_expected_2; s32i a8,a7,24
    l32r a8,.Lk_expected_3; s32i a8,a7,28
    l32r a8,.Lk_expected_4; s32i a8,a7,32
    l32r a8,.Lk_generation_0; s32i a8,a7,36
    l32r a8,.Lk_generation_1; s32i a8,a7,40
    l32r a8,.Lk_generation_2; s32i a8,a7,44
    l32r a8,.Lk_total_bytes_0; s32i a8,a7,48
    l32r a8,.Lk_total_bytes_1; s32i a8,a7,52
    l32r a8,.Lk_total_bytes_2; s32i a8,a7,56
    l32r a8,.Lk_total_chunks_0; s32i a8,a7,60
    l32r a8,.Lk_total_chunks_1; s32i a8,a7,64
    l32r a8,.Lk_total_chunks_2; s32i a8,a7,68
    l32r a8,.Lk_chunk_raw_0; s32i a8,a7,72
    l32r a8,.Lk_chunk_raw_1; s32i a8,a7,76
    l32r a8,.Lk_chunk_raw_2; s32i a8,a7,80
    l32r a8,.Lk_chunk_raw_3; s32i a8,a7,84
    l32r a8,.Lk_sha_0; s32i a8,a7,88
    l32r a8,.Lk_sha_1; s32i a8,a7,92
    l32r a8,.Lk_index_0; s32i a8,a7,96
    l32r a8,.Lk_index_1; s32i a8,a7,100
    l32r a8,.Lk_offset_0; s32i a8,a7,104
    l32r a8,.Lk_offset_1; s32i a8,a7,108
    l32r a8,.Lk_bytes_0; s32i a8,a7,112
    l32r a8,.Lk_bytes_1; s32i a8,a7,116
    l32r a8,.Lk_chunk_sha_0; s32i a8,a7,120
    l32r a8,.Lk_chunk_sha_1; s32i a8,a7,124
    l32r a8,.Lk_chunk_sha_2; s32i a8,a7,128
    l32r a8,.Lk_data_0; s32i a8,a7,132
    l32r a8,.Lk_data_1; s32i a8,a7,136
    l32r a8,.Lr_status_0; s32i a8,a7,140
    l32r a8,.Lr_status_1; s32i a8,a7,144
    l32r a8,.Lr_ok; s32i a8,a7,148
    l32r a8,.Lr_error_0; s32i a8,a7,152
    l32r a8,.Lr_error_1; s32i a8,a7,156
    retw.n
    .size renderer_scene_rpc_init_keys,.-renderer_scene_rpc_init_keys

/* a2=request root,a3=RAM key,a4=key bytes; returns pointer,length or zero. */
    .balign 4
    .type renderer_scene_rpc_read_string,@function
renderer_scene_rpc_read_string:
    entry   a1,48
    mov     a7,a2
    addi    a10,a7,56
    mov     a11,a3
    mov     a12,a4
    movi.n  a13,1
    mov     a14,a7
    l32r    a8,.Lscene_json_lookup
    callx8  a8
    beqz    a10,.Lscene_read_string_fail
    l32r    a8,.Lscene_json_string_tuple
    callx8  a8
    beqz    a10,.Lscene_read_string_fail
    mov     a2,a10
    mov     a3,a11
    retw.n
.Lscene_read_string_fail:
    movi.n  a2,0
    movi.n  a3,0
    retw.n
    .size renderer_scene_rpc_read_string,.-renderer_scene_rpc_read_string

/* a2=request root,a3=RAM key,a4=key bytes; returns value,present. */
    .balign 4
    .global renderer_scene_rpc_read_integer
    .type renderer_scene_rpc_read_integer,@function
renderer_scene_rpc_read_integer:
    entry   a1,48
    mov     a7,a2
    addi    a10,a7,56
    mov     a11,a3
    mov     a12,a4
    movi.n  a13,1
    mov     a14,a7
    l32r    a8,.Lscene_json_lookup
    callx8  a8
    beqz    a10,.Lscene_read_integer_fail
    mov     a11,a7
    l32r    a8,.Lscene_json_integer
    callx8  a8
    mov     a2,a10
    movi.n  a3,1
    retw.n
.Lscene_read_integer_fail:
    movi.n  a2,0
    movi.n  a3,0
    retw.n
    .size renderer_scene_rpc_read_integer,.-renderer_scene_rpc_read_integer

/* a2=response,a3=request,a4=success,a5=persistent scene RPC state. */
    .balign 4
    .global renderer_scene_rpc_reply_status
    .type renderer_scene_rpc_reply_status,@function
renderer_scene_rpc_reply_status:
    entry   a1,112
    mov     a7,a2
    mov     a2,a5                     /* keep the state; a5 is about to move */
    mov     a6,a3
    mov     a3,a4
    addi    a4,a5,313                 /* "status" inside widget.scene.status */
    addi    a5,a5,192                 /* persistent "error" */
    bnei    a3,1,.Lscene_reply_value_ready
    addi    a5,a5,8                   /* persistent "ok" (code 1) */
.Lscene_reply_value_ready:
    l32r    a8,.Lscene_json_allocator
    s32i    a8,a1,16
    movi.n  a9,0
    s8i     a9,a1,20
    s32i    a9,a1,24
    addi    a8,a1,28
    s32i    a8,a1,60
    s16i    a9,a1,64
    movi.n  a8,4
    s16i    a8,a1,66
    movi.n  a8,-1
    s16i    a8,a1,68
    s8i     a9,a1,76
    s16i    a8,a1,78
    mov     a10,a1
    addi    a11,a1,16
    mov     a12,a4
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    mov     a10,a1
    mov     a11,a5
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    bnei    a3,1,.Lscene_reply_emit_code
    j       .Lscene_reply_code_done
.Lscene_reply_emit_code:
    neg     a10,a3
    l32r    a8,.Lcapoff_code_decimal
    add     a11,a2,a8
    call8   renderer_scene_rpc_u32_decimal
    beqz    a10,.Lscene_reply_code_done
    mov     a10,a1
    addi    a11,a1,16
    l32r    a8,.Lcapoff_code_key
    add     a12,a2,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    mov     a10,a1
    l32r    a8,.Lcapoff_code_decimal
    add     a11,a2,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
.Lscene_reply_code_done:
    mov     a10,a7
    mov     a11,a6
    addi    a12,a1,16
    l32r    a8,.Lscene_rpc_respond
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
    retw.n
    .size renderer_scene_rpc_reply_status,.-renderer_scene_rpc_reply_status

/* Handler-local request root constructor. a2=root destination,a3=request. */
    .balign 4
    .global renderer_scene_rpc_make_root
    .type renderer_scene_rpc_make_root,@function
renderer_scene_rpc_make_root:
    entry   a1,48
    mov     a7,a2
    mov     a6,a3
    l32r    a8,.Lscene_rpc_registry
    callx8  a8
    mov     a11,a10
    mov     a10,a7
    mov     a12,a6
    l32r    a8,.Lscene_request_root_ctor
    callx8  a8
    retw.n
    .size renderer_scene_rpc_make_root,.-renderer_scene_rpc_make_root

    .macro SCENE_PARSE_INT root, keys, keyoff, keylen, outoff, fail
    mov     a10,\root
    /* renderer_scene_rpc_init_keys initializes the table at caller SP+16. */
    addi    a11,\keys,(\keyoff + 16)
    movi.n  a12,\keylen
    call8   renderer_scene_rpc_read_integer
    beqz    a11,\fail
    s32i    a10,a1,\outoff
    .endm

    .macro SCENE_PARSE_STRING root, keys, keyoff, keylen, ptroff, lenoff, fail
    mov     a10,\root
    /* renderer_scene_rpc_init_keys initializes the table at caller SP+16. */
    addi    a11,\keys,(\keyoff + 16)
    movi.n  a12,\keylen
    call8   renderer_scene_rpc_read_string
    beqz    a10,\fail
    s32i    a10,a1,\ptroff
    s32i    a11,a1,\lenoff
    .endm

/* Status-only low-level smoke replies. Rich capability promotion remains
 * blocked until this exact app has a physical device receipt. */
    .macro SCENE_SIMPLE_HANDLER name
    .balign 4
    .global \name
    .type \name,@function
\name:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,1f
    beqz    a6,1f
    beqz    a5,1f
    addi    a10,a1,16
    call8   renderer_scene_rpc_init_keys
    addi    a10,a1,288
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    mov     a10,a6
    mov     a11,a5
    movi.n  a12,1
    mov     a13,a7
    call8   renderer_scene_rpc_reply_status
    addi    a10,a1,288
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
1:
    retw.n
    .size \name,.-\name
    .endm

.balign 4
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
    /* Request root retains the accepted callback/request lifetime. */
    addi    a10,a1,96
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    /* committedGeneration -> canonical decimal in persistent RAM. */
    l32i    a10,a7,8
    l32r    a8,.Lcapoff_generation_decimal
    add     a11,a7,a8
    call8   renderer_scene_rpc_u32_decimal
    beqz    a10,.Lscene_cap_return_request
    addi    a4,a1,32
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
    addi    a10,a1,16
    addi    a11,a1,32
    addi    a12,a7,313
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    addi    a11,a7,200
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_protocol_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_protocol_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_profile_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_profile_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_format_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_format_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_bundle_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_bundle_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_chunk_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_chunk_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_chunks_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_chunks_value
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    addi    a10,a1,16
    addi    a11,a1,32
    l32r    a8,.Lcapoff_generation_key
    add     a12,a7,a8
    l32r    a8,.Lscene_json_response_key
    callx8  a8
    addi    a10,a1,16
    l32r    a8,.Lcapoff_generation_decimal
    add     a11,a7,a8
    movi.n  a12,0
    l32r    a8,.Lscene_json_assign_string
    callx8  a8
    mov     a10,a6
    mov     a11,a5
    addi    a12,a1,32
    l32r    a8,.Lscene_rpc_respond
    callx8  a8
    addi    a10,a1,32
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_cap_return_request:
    addi    a10,a1,96
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_cap_return:
    retw.n
    .size renderer_scene_rpc_handle_capabilities,.-renderer_scene_rpc_handle_capabilities
SCENE_SIMPLE_HANDLER renderer_scene_rpc_handle_status

    .balign 4
    .global renderer_scene_rpc_handle_begin
    .type renderer_scene_rpc_handle_begin,@function
renderer_scene_rpc_handle_begin:
    /* Keep the wl_rpc task frame at the live-proven 384-byte ceiling used by
     * capabilities/status.  Keys end at +175, args at +192..+224, and the
     * 64-byte request root at +288, so no larger frame is necessary. */
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lscene_begin_return
    beqz    a6,.Lscene_begin_return
    beqz    a5,.Lscene_begin_return
    addi    a10,a1,16
    call8   renderer_scene_rpc_init_keys
    addi    a10,a1,288
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    addi    a4,a1,288
    SCENE_PARSE_STRING a4,a1,0,13,192,196,.Lscene_begin_error
    l32i    a8,a1,196
    bltui   a8,8,.Lscene_begin_error
    movi.n  a9,40
    bltu    a9,a8,.Lscene_begin_error
    SCENE_PARSE_INT a4,a1,16,18,200,.Lscene_begin_error
    SCENE_PARSE_INT a4,a1,36,10,204,.Lscene_begin_error
    SCENE_PARSE_INT a4,a1,48,10,208,.Lscene_begin_error
    SCENE_PARSE_INT a4,a1,60,11,212,.Lscene_begin_error
    SCENE_PARSE_INT a4,a1,72,13,216,.Lscene_begin_error
    SCENE_PARSE_STRING a4,a1,88,6,220,224,.Lscene_begin_error
    l32i    a8,a1,224
    movi.n  a9,64
    bne     a8,a9,.Lscene_begin_error
    l32i    a8,a1,220
    l8ui    a8,a8,64
    bnez    a8,.Lscene_begin_error
    mov     a10,a7
    addi    a11,a1,192
    call8   renderer_scene_rpc_core_begin_args
    mov     a12,a10
    j       .Lscene_begin_reply
.Lscene_begin_error:
    movi.n  a12,0
.Lscene_begin_reply:
    mov     a10,a6
    mov     a11,a5
    mov     a13,a7
    call8   renderer_scene_rpc_reply_status
    addi    a10,a1,288
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_begin_return:
    retw.n
    .size renderer_scene_rpc_handle_begin,.-renderer_scene_rpc_handle_begin

    .balign 4
    .global renderer_scene_rpc_handle_write
    .type renderer_scene_rpc_handle_write,@function
renderer_scene_rpc_handle_write:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lscene_write_return
    beqz    a6,.Lscene_write_return
    beqz    a5,.Lscene_write_return
    addi    a10,a1,16
    call8   renderer_scene_rpc_init_keys
    addi    a10,a1,288
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    addi    a4,a1,288
    SCENE_PARSE_STRING a4,a1,0,13,192,196,.Lscene_write_error
    l32i    a8,a1,196
    bltui   a8,8,.Lscene_write_error
    movi.n  a9,40
    bltu    a9,a8,.Lscene_write_error
    SCENE_PARSE_INT a4,a1,36,10,200,.Lscene_write_error
    SCENE_PARSE_INT a4,a1,96,5,204,.Lscene_write_error
    SCENE_PARSE_INT a4,a1,104,6,208,.Lscene_write_error
    SCENE_PARSE_INT a4,a1,112,5,212,.Lscene_write_error
    SCENE_PARSE_STRING a4,a1,120,11,216,228,.Lscene_write_error
    l32i    a8,a1,228
    movi.n  a9,64
    bne     a8,a9,.Lscene_write_error
    l32i    a8,a1,216
    l8ui    a8,a8,64
    bnez    a8,.Lscene_write_error
    SCENE_PARSE_STRING a4,a1,132,4,220,224,.Lscene_write_error
    l32i    a8,a1,224
    beqz    a8,.Lscene_write_error
    movi    a9,4096
    bltu    a9,a8,.Lscene_write_error
    mov     a10,a7
    addi    a11,a1,192
    call8   renderer_scene_rpc_core_write_base64_args
    mov     a12,a10
    j       .Lscene_write_reply
.Lscene_write_error:
    movi.n  a12,0
.Lscene_write_reply:
    mov     a10,a6
    mov     a11,a5
    mov     a13,a7
    call8   renderer_scene_rpc_reply_status
    addi    a10,a1,288
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_write_return:
    retw.n
    .size renderer_scene_rpc_handle_write,.-renderer_scene_rpc_handle_write

    .balign 4
    .global renderer_scene_rpc_handle_commit
    .type renderer_scene_rpc_handle_commit,@function
renderer_scene_rpc_handle_commit:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lscene_commit_return
    beqz    a6,.Lscene_commit_return
    beqz    a5,.Lscene_commit_return
    addi    a10,a1,16
    call8   renderer_scene_rpc_init_keys
    addi    a10,a1,288
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    addi    a4,a1,288
    SCENE_PARSE_STRING a4,a1,0,13,192,196,.Lscene_commit_error
    l32i    a8,a1,196
    bltui   a8,8,.Lscene_commit_error
    movi.n  a9,40
    bltu    a9,a8,.Lscene_commit_error
    SCENE_PARSE_INT a4,a1,16,18,200,.Lscene_commit_error
    SCENE_PARSE_INT a4,a1,36,10,204,.Lscene_commit_error
    SCENE_PARSE_INT a4,a1,48,10,208,.Lscene_commit_error
    SCENE_PARSE_INT a4,a1,60,11,212,.Lscene_commit_error
    SCENE_PARSE_STRING a4,a1,88,6,216,220,.Lscene_commit_error
    l32i    a8,a1,220
    movi.n  a9,64
    bne     a8,a9,.Lscene_commit_error
    l32i    a8,a1,216
    l8ui    a8,a8,64
    bnez    a8,.Lscene_commit_error
    mov     a10,a7
    addi    a11,a1,192
    call8   renderer_scene_rpc_core_commit_args
    mov     a12,a10
    j       .Lscene_commit_reply
.Lscene_commit_error:
    movi.n  a12,0
.Lscene_commit_reply:
    mov     a10,a6
    mov     a11,a5
    mov     a13,a7
    call8   renderer_scene_rpc_reply_status
    addi    a10,a1,288
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_commit_return:
    retw.n
    .size renderer_scene_rpc_handle_commit,.-renderer_scene_rpc_handle_commit

    .balign 4
    .global renderer_scene_rpc_handle_abort
    .type renderer_scene_rpc_handle_abort,@function
renderer_scene_rpc_handle_abort:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lscene_abort_return
    beqz    a6,.Lscene_abort_return
    beqz    a5,.Lscene_abort_return
    addi    a10,a1,16
    call8   renderer_scene_rpc_init_keys
    addi    a10,a1,288
    mov     a11,a5
    call8   renderer_scene_rpc_make_root
    addi    a4,a1,288
    SCENE_PARSE_STRING a4,a1,0,13,192,196,.Lscene_abort_error
    l32i    a8,a1,196
    bltui   a8,8,.Lscene_abort_error
    movi.n  a9,40
    bltu    a9,a8,.Lscene_abort_error
    SCENE_PARSE_INT a4,a1,36,10,200,.Lscene_abort_error
    mov     a10,a7
    l32i    a11,a1,192
    l32i    a12,a1,196
    l32i    a13,a1,200
    call8   renderer_scene_rpc_core_abort
    mov     a12,a10
    j       .Lscene_abort_reply
.Lscene_abort_error:
    movi.n  a12,0
.Lscene_abort_reply:
    mov     a10,a6
    mov     a11,a5
    mov     a13,a7
    call8   renderer_scene_rpc_reply_status
    addi    a10,a1,288
    l32r    a8,.Lscene_json_root_dtor
    callx8  a8
.Lscene_abort_return:
    retw.n
    .size renderer_scene_rpc_handle_abort,.-renderer_scene_rpc_handle_abort
