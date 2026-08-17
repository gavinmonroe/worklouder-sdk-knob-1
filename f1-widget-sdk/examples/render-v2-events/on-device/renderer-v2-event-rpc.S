/*
 * One bounded Render-v2 host-event RPC for the accepted Framer F1 0.4.1 ABI.
 *
 * Method: widget.v2.event
 * Params: {"id":45569,"value":<int32>}
 * Reply:  exact status-only {"status":"ok"} or {"status":"error"}
 *
 * The callback only validates two integers and calls the native bounded queue
 * producer. It never invokes LVGL or touches the framebuffer. Existing,
 * physically exercised scene-RPC helpers provide JSON parsing, callback
 * registration, response construction, and request-root destruction.
 */

    .section .literal.renderer_v2_rpc,"a",@progbits
    .balign 4
.Lrv2_operator_new:              .long 0x420e7c04
.Lrv2_rpc_registry:              .long 0x42004afc
.Lrv2_scene_register_one:        .long 0x4211f660
.Lrv2_scene_make_root:           .long 0x4211f960
.Lrv2_scene_read_integer:        .long 0x4211f8c4
.Lrv2_scene_reply_status:        .long 0x4211f8f0
.Lrv2_json_root_dtor:            .long 0x42004f80
.Lrv2_expected_id:               .long 0x0000b201
.Lrv2_callback:                  .long renderer_v2_rpc_callback

/* Integer words are copied into persistent RAM before registration/parsing. */
.Lrv2_w_widget:                  .long 0x67646977 /* widg */
.Lrv2_w_et_v:                    .long 0x762e7465 /* et.v */
.Lrv2_w_2_ev:                    .long 0x76652e32 /* 2.ev */
.Lrv2_w_ent0:                    .long 0x00746e65 /* ent\0 */
.Lrv2_w_id0:                     .long 0x00006469 /* id\0\0 */
.Lrv2_w_valu:                    .long 0x756c6176 /* valu */
.Lrv2_w_e0:                      .long 0x00000065 /* e\0\0\0 */

    .section .text.renderer_v2_rpc,"ax",@progbits
    .balign 4

/* a2=renderer-v1 controller,a3=accepted scene-RPC state; returns state/null. */
    .global renderer_v2_rpc_register
    .type renderer_v2_rpc_register,@function
renderer_v2_rpc_register:
    entry   a1,64
    beqz    a2,.Lrv2_register_fail
    beqz    a3,.Lrv2_register_fail
    mov     a7,a2
    mov     a6,a3
    movi.n  a10,40
    l32r    a8,.Lrv2_operator_new
    callx8  a8
    mov     a5,a10
    beqz    a5,.Lrv2_register_fail
    mov     a10,a5
    movi.n  a9,0
    movi.n  a11,40
.Lrv2_clear_state:
    s8i     a9,a10,0
    addi    a10,a10,1
    addi    a11,a11,-1
    bnez    a11,.Lrv2_clear_state
    s32i.n  a7,a5,0
    s32i.n  a6,a5,4
    l32r    a8,.Lrv2_w_widget
    s32i    a8,a5,8
    l32r    a8,.Lrv2_w_et_v
    s32i    a8,a5,12
    l32r    a8,.Lrv2_w_2_ev
    s32i    a8,a5,16
    l32r    a8,.Lrv2_w_ent0
    s32i    a8,a5,20
    l32r    a8,.Lrv2_w_id0
    s32i    a8,a5,24
    l32r    a8,.Lrv2_w_valu
    s32i    a8,a5,28
    l32r    a8,.Lrv2_w_e0
    s32i    a8,a5,32
    memw
    l32r    a8,.Lrv2_rpc_registry
    callx8  a8
    beqz    a10,.Lrv2_register_fail
    mov     a11,a5
    addi    a12,a5,8
    movi.n  a13,15
    l32r    a14,.Lrv2_callback
    l32r    a8,.Lrv2_scene_register_one
    callx8  a8
    mov     a2,a5
    retw.n
.Lrv2_register_fail:
    movi.n  a2,0
    retw.n
    .size renderer_v2_rpc_register,.-renderer_v2_rpc_register

/* Stock dispatch thunk: callback, response holder, request. */
    .balign 4
    .global renderer_v2_rpc_callback
    .type renderer_v2_rpc_callback,@function
renderer_v2_rpc_callback:
    entry   a1,32
    mov     a12,a4
    l32i.n  a11,a3,0
    l32i.n  a10,a2,0
    call8   renderer_v2_rpc_handle
    retw.n
    .size renderer_v2_rpc_callback,.-renderer_v2_rpc_callback

/* a2=our state,a3=response context,a4=request. */
    .balign 4
    .global renderer_v2_rpc_handle
    .type renderer_v2_rpc_handle,@function
renderer_v2_rpc_handle:
    entry   a1,384
    mov     a7,a2
    mov     a6,a3
    mov     a5,a4
    beqz    a7,.Lrv2_handle_return
    beqz    a6,.Lrv2_handle_return
    beqz    a5,.Lrv2_handle_return
    addi    a10,a1,288
    mov     a11,a5
    l32r    a8,.Lrv2_scene_make_root
    callx8  a8
    addi    a4,a1,288
    mov     a10,a4
    addi    a11,a7,24
    movi.n  a12,2
    l32r    a8,.Lrv2_scene_read_integer
    callx8  a8
    beqz    a11,.Lrv2_event_error
    s32i    a10,a1,192
    l32r    a8,.Lrv2_expected_id
    bne     a10,a8,.Lrv2_event_error
    mov     a10,a4
    addi    a11,a7,28
    movi.n  a12,5
    l32r    a8,.Lrv2_scene_read_integer
    callx8  a8
    beqz    a11,.Lrv2_event_error
    s32i    a10,a1,196
    l32i.n  a10,a7,0
    l32i    a11,a1,192
    l32i    a12,a1,196
    call8   renderer_v2_native_host_event
    beqz    a10,.Lrv2_event_error
    movi.n  a12,1
    j       .Lrv2_event_reply
.Lrv2_event_error:
    movi.n  a12,0
.Lrv2_event_reply:
    mov     a10,a6
    mov     a11,a5
    l32i.n  a13,a7,4
    l32r    a8,.Lrv2_scene_reply_status
    callx8  a8
    addi    a10,a1,288
    l32r    a8,.Lrv2_json_root_dtor
    callx8  a8
.Lrv2_handle_return:
    retw.n
    .size renderer_v2_rpc_handle,.-renderer_v2_rpc_handle

