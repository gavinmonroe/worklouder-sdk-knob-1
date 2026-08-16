/*
 * Framer F1 0.4.1 Stage-3C / Stage-3D ABI candidate.
 *
 * OFFLINE REVIEW ARTIFACT ONLY. This file is intentionally not consumed by a
 * firmware-image builder. It exercises the inferred registration, heap-backed
 * vtable, bubble-controller, and LVGL-refresh ABIs for the Stage-3C selectable
 * WPM-number proof.  It also round-trips an unreferenced any-key wrapper for
 * later Stage-3D pet semantics.  Stage 3C must leave the stock key-callback
 * literal unchanged.
 */

    .section .literal.stage3c_wpm, "a", @progbits
    .balign 4
.Loriginal_screen_setup:    .long 0x4202c108
.Lroot_registry_getter:     .long 0x42004e1c
.Lregistry_from_root:       .long 0x4210ad9c
.Lscreen_manager_getter:    .long 0x42006888
.Lcurrent_controller_getter:.long 0x4210af48
.Loperator_new:             .long 0x420e7c04
.Lmemset:                   .long 0x400011e8
.Lbase_vtable:              .long 0x3c1acc34
.Ladd_controller:           .long 0x4204da84
.Ladd_navigation_id:        .long 0x420293a8

/* Eleven-word controller vtable, copied into object +64 at runtime. */
.Lvtable_slot_0:            .long 0x4204d5dc
.Lvtable_slot_1:            .long 0x4210aefc
.Lvtable_slot_2:            .long 0x4204d694
.Lvtable_slot_3:            .long stage3c_wpm_show
.Lvtable_slot_4:            .long stage3c_wpm_cleanup
.Lvtable_slot_5:            .long 0x4204d6d0
.Lvtable_slot_6:            .long stage3c_wpm_ui_refresh
.Lvtable_slot_7:            .long 0x42108834
.Lvtable_slot_8:            .long stage3c_wpm_id
.Lvtable_slot_9:            .long 0x4210883c
.Lvtable_slot_10:           .long 0x42108844

/* Existing Framer bubble and formatting implementation/data. */
.Lstring_assign_cstr:       .long 0x42003dc8
.Lbubble_model:             .long 0x3fca4f00
.Lwpm_label:                .long 0x3c12e738 /* Existing "wpm" string. */
.Lok_value:                 .long 0x3c12eaf7 /* Existing "OK" string. */
.Lbubble_view_getter:       .long 0x42004f10
.Lbubble_update:            .long 0x4201a930
.Lsnprintf:                 .long 0x420f896c
.Lunsigned_format:          .long 0x3c1258d8 /* Existing "%4u" string. */
.Lwpm_current:              .long 0x3fcaba20

/* Original key middleware callback; the wrapper always calls it first. */
.Loriginal_key_callback:    .long 0x4206eae0

    .section .text.stage3c_wpm, "ax", @progbits
    .balign 4

/*
 * Candidate replacement for DROM vtable word 0x3c1ac194.
 *
 * The stock singleton at 0x3fcace20 is called through this vtable slot during
 * normal UI setup. The wrapper preserves the entire original setup call, then
 * allocates one 112-byte object: base/controller state at +0..+63 and an
 * eleven-word writable vtable at +64..+107.
 */
    .global stage3c_screen_setup_wrapper
    .type stage3c_screen_setup_wrapper, @function
stage3c_screen_setup_wrapper:
    entry   a1, 48

    mov     a10, a2
    l32r    a8, .Loriginal_screen_setup
    callx8  a8
    mov     a4, a10

    l32r    a8, .Lroot_registry_getter
    callx8  a8
    l32r    a8, .Lregistry_from_root
    callx8  a8
    mov     a7, a10

    l32r    a8, .Lscreen_manager_getter
    callx8  a8
    mov     a6, a10

    movi    a10, 112
    l32r    a8, .Loperator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lsetup_done

    mov     a10, a5
    movi.n  a11, 0
    movi    a12, 112
    l32r    a8, .Lmemset
    callx8  a8

    /* Mirror the stock simple-controller base initialization. */
    l32r    a8, .Lbase_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26

    /* Build a data-bus-readable vtable inside the controller allocation. */
    addi    a9, a5, 64
    l32r    a8, .Lvtable_slot_0
    s32i    a8, a9, 0
    l32r    a8, .Lvtable_slot_1
    s32i    a8, a9, 4
    l32r    a8, .Lvtable_slot_2
    s32i    a8, a9, 8
    l32r    a8, .Lvtable_slot_3
    s32i    a8, a9, 12
    l32r    a8, .Lvtable_slot_4
    s32i    a8, a9, 16
    l32r    a8, .Lvtable_slot_5
    s32i    a8, a9, 20
    l32r    a8, .Lvtable_slot_6
    s32i    a8, a9, 24
    l32r    a8, .Lvtable_slot_7
    s32i    a8, a9, 28
    l32r    a8, .Lvtable_slot_8
    s32i    a8, a9, 32
    l32r    a8, .Lvtable_slot_9
    s32i    a8, a9, 36
    l32r    a8, .Lvtable_slot_10
    s32i    a8, a9, 40
    s32i.n  a9, a5, 0

    mov     a10, a7
    mov     a11, a5
    l32r    a8, .Ladd_controller
    callx8  a8

    /* Navigation registration is deliberately last. */
    mov     a10, a6
    movi.n  a11, 7
    l32r    a8, .Ladd_navigation_id
    callx8  a8

.Lsetup_done:
    /* Windowed ABI: this function's a2 maps back to the caller's a10. */
    mov     a2, a4
    retw.n
    .size stage3c_screen_setup_wrapper, . - stage3c_screen_setup_wrapper

/*
 * Candidate controller vtable slot 3 (activation hook).
 *
 * The stock slot-2 implementation creates an LVGL timer, invokes slot 3 once,
 * then invokes slot 6 once.  This hook initializes the global bubble before
 * the first UI-thread refresh.
 */
    .balign 4
    .global stage3c_wpm_show
    .type stage3c_wpm_show, @function
stage3c_wpm_show:
    entry   a1, 32

    /* Publish immediately from the slot-6 call made by common slot 2. */
    movi.n  a8, 4
    s32i.n  a8, a2, 28
    movi.n  a8, 0
    s32i.n  a8, a2, 32

    l32r    a10, .Lbubble_model
    l32r    a11, .Lwpm_label
    l32r    a8, .Lstring_assign_cstr
    callx8  a8

    l32r    a10, .Lbubble_model
    addi    a10, a10, 24
    l32r    a11, .Lok_value
    l32r    a8, .Lstring_assign_cstr
    callx8  a8

    l32r    a8, .Lbubble_model
    movi.n  a9, 1
    s8i     a9, a8, 48
    s8i     a9, a8, 49
    l32r    a8, .Lbubble_view_getter
    callx8  a8
    l32r    a11, .Lbubble_model
    l32r    a8, .Lbubble_update
    callx8  a8
    retw.n
    .size stage3c_wpm_show, . - stage3c_wpm_show

/* Candidate controller vtable slot 4: hide the bubble on screen exit. */
    .balign 4
    .global stage3c_wpm_cleanup
    .type stage3c_wpm_cleanup, @function
stage3c_wpm_cleanup:
    entry   a1, 32
    l32r    a8, .Lbubble_model
    movi.n  a9, 0
    s8i     a9, a8, 48
    s8i     a9, a8, 49
    l32r    a8, .Lbubble_view_getter
    callx8  a8
    l32r    a11, .Lbubble_model
    l32r    a8, .Lbubble_update
    callx8  a8
    retw.n
    .size stage3c_wpm_cleanup, . - stage3c_wpm_cleanup

/* Candidate controller vtable slot 8. */
    .balign 4
    .global stage3c_wpm_id
    .type stage3c_wpm_id, @function
stage3c_wpm_id:
    entry   a1, 32
    movi.n  a2, 7
    retw.n
    .size stage3c_wpm_id, . - stage3c_wpm_id

/*
 * Candidate controller vtable slot 6.  The stock base callback at 0x4204d680
 * reaches this method from an LVGL timer every 100 ms while this controller's
 * screen is active.  +28 divides those calls down to a 500-ms UI-thread
 * publish cadence; +32 counts 100-ms idle ticks for later Stage 3D.  Native
 * kb_stats continues to update 0x3fcaba20 at its unchanged 500-ms cadence; no
 * middleware-timer hook mutates UI state.
 */
    .balign 4
    .global stage3c_wpm_ui_refresh
    .type stage3c_wpm_ui_refresh, @function
stage3c_wpm_ui_refresh:
    entry   a1, 48

    l32i.n  a8, a2, 32
    addi    a8, a8, 1
    s32i.n  a8, a2, 32

    l32i.n  a8, a2, 28
    addi    a8, a8, 1
    bltui   a8, 5, .Lrefresh_not_due
    movi.n  a8, 0
    s32i.n  a8, a2, 28

    l32r    a8, .Lwpm_current
    lsi     f0, a8, 0
    utrunc.s a13, f0, 0
    l32r    a12, .Lunsigned_format
    movi.n  a11, 8
    addi    a10, a1, 4
    l32r    a8, .Lsnprintf
    callx8  a8

    l32r    a10, .Lbubble_model
    addi    a10, a10, 24
    addi    a11, a1, 4
    l32r    a8, .Lstring_assign_cstr
    callx8  a8

    l32r    a8, .Lbubble_view_getter
    callx8  a8
    l32r    a11, .Lbubble_model
    l32r    a8, .Lbubble_update
    callx8  a8
    retw.n

.Lrefresh_not_due:
    s32i.n  a8, a2, 28
    retw.n
    .size stage3c_wpm_ui_refresh, . - stage3c_wpm_ui_refresh

/*
 * Stage-3D-only candidate replacement for key-callback literal 0x42041568.
 * Calls stock handling first; a pressed key resets active ID-7 idle ticks at
 * +32.  It touches only controller RAM, never strings or LVGL state.
 * This function is deliberately unreferenced by the Stage-3C proof.
 */
    .balign 4
    .global stage3c_key_callback_wrapper
    .type stage3c_key_callback_wrapper, @function
stage3c_key_callback_wrapper:
    entry   a1, 32
    mov     a10, a2
    mov     a11, a3
    mov     a12, a4
    l32r    a8, .Loriginal_key_callback
    callx8  a8
    mov     a5, a10

    l8ui    a8, a4, 0
    beqz    a8, .Lkey_done
    l32r    a8, .Lscreen_manager_getter
    callx8  a8
    l32r    a8, .Lcurrent_controller_getter
    callx8  a8
    beqz    a10, .Lkey_done
    mov     a6, a10
    l32i.n  a8, a10, 0
    l32i    a8, a8, 32
    callx8  a8
    bnei    a10, 7, .Lkey_done
    movi.n  a9, 0
    s32i.n  a9, a6, 32

.Lkey_done:
    /* Preserve the stock callback result in the windowed return register. */
    mov     a2, a5
    retw.n
    .size stage3c_key_callback_wrapper, . - stage3c_key_callback_wrapper

    /* Firmware IROM extensions are always rounded to a 4-byte boundary. */
    .balign 4
