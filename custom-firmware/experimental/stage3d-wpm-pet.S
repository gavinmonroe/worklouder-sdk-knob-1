/*
 * Framer F1 0.4.1 Stage-3D native WPM pet.
 *
 * OFFLINE ABI ARTIFACT ONLY. Stage-3D appends after the exact live-tested
 * Stage-3C.1 tail. A future builder must redirect the central setup pointer
 * to stage3d_screen_setup_wrapper and the stock key-callback literal to
 * stage3d_key_callback_wrapper. No image is built by this source.
 *
 * The controller owns four ordinary LVGL labels under its +12 content root:
 * cat ears, cat face, current WPM, and A/H/L session statistics. The key
 * wrapper calls stock first and then increments one aligned activity epoch
 * only while screen ID 7 is current. The 100-ms UI callback is the sole
 * writer of idle/session/stat state, so there is no reset RMW race.
 */

    .section .literal.stage3d_wpm_pet, "a", @progbits
    .balign 4
.Loriginal_screen_setup:      .long 0x4202c108
.Loriginal_key_callback:      .long 0x4206eae0
.Lroot_registry_getter:       .long 0x42004e1c
.Lregistry_from_root:         .long 0x4210ad9c
.Lscreen_manager_getter:      .long 0x42006888
.Lscreen_manager_object:      .long 0x3fcab378
.Loperator_new:               .long 0x420e7c04
.Lmemset:                     .long 0x400011e8
.Lbase_vtable:                .long 0x3c1acc34
.Ladd_controller:             .long 0x4204da84
.Ladd_navigation_id:          .long 0x420293a8

/* Eleven-word controller vtable copied into object +128 at runtime. */
.Lvtable_slot_0:              .long 0x4204d5dc
.Lvtable_slot_1:              .long stage3d_wpm_build
.Lvtable_slot_2:              .long 0x4204d694
.Lvtable_slot_3:              .long 0x4210882c
.Lvtable_slot_4:              .long stage3d_wpm_cleanup
.Lvtable_slot_5:              .long 0x4204d6d0
.Lvtable_slot_6:              .long stage3d_wpm_ui_refresh
.Lvtable_slot_7:              .long 0x42108834
.Lvtable_slot_8:              .long stage3d_wpm_id
.Lvtable_slot_9:              .long 0x4210883c
.Lvtable_slot_10:             .long 0x42108844

/* Live-proven label helpers and two stock fonts with dense ASCII cmaps. */
.Llabel_create:                .long 0x4204f170
.Llabel_set_font:              .long 0x4204f018
.Llabel_align:                 .long 0x4204f0d0
.Llabel_set_text:              .long 0x4204ee30
.Lsmall_font_ascii:            .long 0x3c18e960 /* line height 14, U+20..U+7E */
.Llarge_font_ascii:            .long 0x3c18ceac /* line height 27, U+20..U+7E */
.Lsnprintf:                    .long 0x420f896c
.Lwpm_current:                 .long 0x3fcaba20
.Lsession_reset_ticks:         .long 3000 /* 5 minutes at 100 ms */
.Lsample_rebase_count:         .long 65536

/* New strings are copied from IROM literal words into stack buffers. */
.Lears_0:                      .long 0x2f5f5c2f /* "/\\_/" */
.Lears_1:                      .long 0x0000005c /* "\\\0" */
.Lcurrent_initial_0:           .long 0x70772030 /* "0 wp" */
.Lcurrent_initial_1:           .long 0x0000006d /* "m\0" */
.Lstats_initial_0:             .long 0x48203041 /* "A0 H" */
.Lstats_initial_1:             .long 0x304c2030 /* "0 L0" */
.Lstats_initial_2:             .long 0x00000000
.Lcurrent_format_0:            .long 0x77207525 /* "%u w" */
.Lcurrent_format_1:            .long 0x00006d70 /* "pm\0" */
.Lstats_format_0:              .long 0x20752541 /* "A%u " */
.Lstats_format_1:              .long 0x20752548 /* "H%u " */
.Lstats_format_2:              .long 0x0075254c /* "L%u\0" */

/* Compact ASCII faces, also copied to an 8-byte stack buffer. */
.Lface_ready_lo:               .long 0x6f2e6f28 /* "(o.o" */
.Lface_hatching_lo:            .long 0x3f2e3f28 /* "(?.?" */
.Lface_sleeping_lo:            .long 0x2d2e2d28 /* "(-.-" */
.Lface_waiting_lo:             .long 0x2e5f2e28 /* "(._." */
.Lface_fire_lo:                .long 0x5e4f5e28 /* "(^O^" */
.Lface_zooming_lo:             .long 0x3c6f3e28 /* "(>o<" */
.Lface_happy_lo:               .long 0x5e2e5e28 /* "(^.^" */
.Lface_tired_lo:               .long 0x752e7528 /* "(u.u" */
.Lface_default_hi:             .long 0x00000029 /* ")\0\0\0" */
.Lface_sleeping_hi:            .long 0x00007a29 /* ")z\0\0" */
.Lface_fire_hi:                .long 0x00002129 /* ")!\0\0" */

    .section .text.stage3d_wpm_pet, "ax", @progbits
    .balign 4

/*
 * State layout. Common controller fields end at +27.
 *
 * +28 divider100ms        +32 idleTicks100ms      +36 activityEpoch
 * +40 seenEpoch           +44 sessionTicks         +48 active500msSamples
 * +52 sampleCount         +56 sampleSum            +60 sessionHigh
 * +64 sessionLow          +68 celebrationTicks     +72 sessionActive
 * +76 currentRounded      +80 earsLabel            +84 faceLabel
 * +88 currentLabel        +92 statsLabel            +96 averageRounded
 * +100 petState           +104..+127 reserved      +128..+171 vtable
 *
 * The allocation is 176 bytes, leaving four padding bytes after the vtable.
 * The key callback is the sole writer of +36. All other state has one UI
 * writer. Slot 1/reset must therefore never clear +36.
 */

    .global stage3d_screen_setup_wrapper
    .type stage3d_screen_setup_wrapper, @function
stage3d_screen_setup_wrapper:
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

    movi    a10, 176
    l32r    a8, .Loperator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lsetup_done

    mov     a10, a5
    movi.n  a11, 0
    movi    a12, 176
    l32r    a8, .Lmemset
    callx8  a8

    l32r    a8, .Lbase_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26

    addi    a9, a5, 128
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

    mov     a10, a6
    movi.n  a11, 7
    l32r    a8, .Ladd_navigation_id
    callx8  a8

.Lsetup_done:
    mov     a2, a4
    retw.n
    .size stage3d_screen_setup_wrapper, . - stage3d_screen_setup_wrapper

/* a2=parent, a3=font, a4=y, a5=initial text; returns label in a2. */
    .balign 4
    .type stage3d_make_label, @function
stage3d_make_label:
    entry   a1, 48
    mov     a10, a2
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a6, a10
    beqz    a6, .Lmake_label_done

    mov     a10, a6
    mov     a11, a3
    movi.n  a12, 0
    l32r    a8, .Llabel_set_font
    callx8  a8

    mov     a10, a6
    movi.n  a11, 2
    movi.n  a12, 0
    mov     a13, a4
    l32r    a8, .Llabel_align
    callx8  a8

    mov     a10, a6
    mov     a11, a5
    l32r    a8, .Llabel_set_text
    callx8  a8
.Lmake_label_done:
    mov     a2, a6
    retw.n
    .size stage3d_make_label, . - stage3d_make_label

/* Reset a visible session. Labels, divider, and producer epoch are retained. */
    .balign 4
    .type stage3d_reset_session, @function
stage3d_reset_session:
    entry   a1, 32
    movi.n  a8, 0
    s32i    a8, a2, 32
    s32i    a8, a2, 40
    s32i    a8, a2, 44
    s32i    a8, a2, 48
    s32i    a8, a2, 52
    s32i    a8, a2, 56
    s32i    a8, a2, 60
    s32i    a8, a2, 68
    s32i    a8, a2, 72
    s32i    a8, a2, 76
    s32i    a8, a2, 96
    s32i    a8, a2, 100
    movi.n  a8, -1
    s32i    a8, a2, 64
    retw.n
    .size stage3d_reset_session, . - stage3d_reset_session

/* Slot 1: reset UI-owned state, snapshot epoch, and create owned labels. */
    .balign 4
    .global stage3d_wpm_build
    .type stage3d_wpm_build, @function
stage3d_wpm_build:
    entry   a1, 96
    mov     a7, a2

    mov     a10, a7
    call8   stage3d_reset_session
    l32i    a8, a7, 36
    s32i    a8, a7, 40
    movi.n  a8, 4
    s32i.n  a8, a7, 28

    /* Ears: /\\_/\\ */
    l32r    a8, .Lears_0
    s32i    a8, a1, 16
    l32r    a8, .Lears_1
    s32i    a8, a1, 20
    l32i.n  a10, a7, 12
    l32r    a11, .Llarge_font_ascii
    movi.n  a12, 12
    addi    a13, a1, 16
    call8   stage3d_make_label
    s32i    a10, a7, 80

    movi.n  a10, 0
    addi    a11, a1, 32
    call8   stage3d_write_face
    l32i.n  a10, a7, 12
    l32r    a11, .Llarge_font_ascii
    movi.n  a12, 44
    addi    a13, a1, 32
    call8   stage3d_make_label
    s32i    a10, a7, 84

    l32r    a8, .Lcurrent_initial_0
    s32i    a8, a1, 48
    l32r    a8, .Lcurrent_initial_1
    s32i    a8, a1, 52
    l32i.n  a10, a7, 12
    l32r    a11, .Lsmall_font_ascii
    movi.n  a12, 86
    addi    a13, a1, 48
    call8   stage3d_make_label
    s32i    a10, a7, 88

    l32r    a8, .Lstats_initial_0
    s32i    a8, a1, 64
    l32r    a8, .Lstats_initial_1
    s32i    a8, a1, 68
    l32r    a8, .Lstats_initial_2
    s32i    a8, a1, 72
    l32i.n  a10, a7, 12
    l32r    a11, .Lsmall_font_ascii
    movi.n  a12, 112
    addi    a13, a1, 64
    call8   stage3d_make_label
    s32i    a10, a7, 92
    retw.n
    .size stage3d_wpm_build, . - stage3d_wpm_build

/* Slot 4: LVGL auto-delete owns objects; clear only borrowed pointers. */
    .balign 4
    .global stage3d_wpm_cleanup
    .type stage3d_wpm_cleanup, @function
stage3d_wpm_cleanup:
    entry   a1, 32
    movi.n  a8, 0
    s32i    a8, a2, 80
    s32i    a8, a2, 84
    s32i    a8, a2, 88
    s32i    a8, a2, 92
    retw.n
    .size stage3d_wpm_cleanup, . - stage3d_wpm_cleanup

    .balign 4
    .global stage3d_wpm_id
    .type stage3d_wpm_id, @function
stage3d_wpm_id:
    entry   a1, 32
    movi.n  a2, 7
    retw.n
    .size stage3d_wpm_id, . - stage3d_wpm_id

/* a2=pet-state enum, a3=8-byte output buffer. */
    .balign 4
    .type stage3d_write_face, @function
stage3d_write_face:
    entry   a1, 32
    l32r    a8, .Lface_ready_lo
    l32r    a9, .Lface_default_hi
    beqi    a2, 1, .Lface_hatching
    beqi    a2, 2, .Lface_sleeping
    beqi    a2, 3, .Lface_waiting
    beqi    a2, 4, .Lface_fire
    beqi    a2, 5, .Lface_zooming
    beqi    a2, 6, .Lface_happy
    beqi    a2, 7, .Lface_tired
    j       .Lface_store
.Lface_hatching:
    l32r    a8, .Lface_hatching_lo
    j       .Lface_store
.Lface_sleeping:
    l32r    a8, .Lface_sleeping_lo
    l32r    a9, .Lface_sleeping_hi
    j       .Lface_store
.Lface_waiting:
    l32r    a8, .Lface_waiting_lo
    j       .Lface_store
.Lface_fire:
    l32r    a8, .Lface_fire_lo
    l32r    a9, .Lface_fire_hi
    j       .Lface_store
.Lface_zooming:
    l32r    a8, .Lface_zooming_lo
    j       .Lface_store
.Lface_happy:
    l32r    a8, .Lface_happy_lo
    j       .Lface_store
.Lface_tired:
    l32r    a8, .Lface_tired_lo
.Lface_store:
    s32i.n  a8, a3, 0
    s32i.n  a9, a3, 4
    retw.n
    .size stage3d_write_face, . - stage3d_write_face

/* Sample/render every 500 ms; the 20th active nonzero sample starts A/H/L. */
    .balign 4
    .type stage3d_sample_and_render, @function
stage3d_sample_and_render:
    entry   a1, 128
    mov     a7, a2

    l32r    a8, .Lwpm_current
    lsi     f0, a8, 0
    utrunc.s a6, f0, 0
    movi    a9, 999
    bgeu    a9, a6, .Lcurrent_clamped
    mov     a6, a9
.Lcurrent_clamped:
    s32i    a6, a7, 76

    l32i    a8, a7, 72
    beqz    a8, .Lsample_done
    beqz    a6, .Lsample_done
    l32i    a8, a7, 32
    movi.n  a9, 50
    bgeu    a8, a9, .Lsample_done

    l32i    a5, a7, 48
    movi.n  a9, 20
    bgeu    a5, a9, .Lsample_mature
    addi    a5, a5, 1
    s32i    a5, a7, 48
    bltu    a5, a9, .Lsample_done

.Lsample_mature:
    l32i    a5, a7, 52
    l32r    a9, .Lsample_rebase_count
    bltu    a5, a9, .Lsample_after_rebase
    srli    a5, a5, 1
    l32i    a8, a7, 56
    srli    a8, a8, 1
    s32i    a5, a7, 52
    s32i    a8, a7, 56
.Lsample_after_rebase:
    bnez    a5, .Lsample_existing
    movi.n  a8, 1
    s32i    a8, a7, 52
    s32i    a6, a7, 56
    s32i    a6, a7, 60
    s32i    a6, a7, 64
    j       .Lsample_done

.Lsample_existing:
    l32i    a8, a7, 56
    add     a8, a8, a6
    s32i    a8, a7, 56
    addi    a8, a5, 1
    s32i    a8, a7, 52

    l32i    a8, a7, 60
    bgeu    a8, a6, .Lsample_low
    bltui   a5, 3, .Lsample_set_high
    movi.n  a9, 15
    s32i    a9, a7, 68
.Lsample_set_high:
    s32i    a6, a7, 60
.Lsample_low:
    l32i    a8, a7, 64
    bgeu    a6, a8, .Lsample_done
    s32i    a6, a7, 64

.Lsample_done:
    l32i    a8, a7, 52
    beqz    a8, .Laverage_zero
    l32i    a9, a7, 56
    quou    a5, a9, a8
    j       .Laverage_store
.Laverage_zero:
    movi.n  a5, 0
.Laverage_store:
    s32i    a5, a7, 96

    movi.n  a4, 0
    l32i    a8, a7, 72
    beqz    a8, .Lstate_selected
    l32i    a8, a7, 32
    movi    a9, 300
    bgeu    a8, a9, .Lstate_sleeping
    movi.n  a9, 50
    bgeu    a8, a9, .Lstate_waiting
    l32i    a8, a7, 48
    movi.n  a9, 20
    bltu    a8, a9, .Lstate_hatching
    l32i    a8, a7, 68
    bnez    a8, .Lstate_fire
    l32i    a8, a7, 60
    movi.n  a9, 9
    mull    a8, a8, a9
    movi.n  a9, 10
    mull    a10, a6, a9
    bgeu    a10, a8, .Lstate_zooming
    bgeu    a6, a5, .Lstate_happy
    l32i    a8, a7, 64
    movi.n  a9, 11
    mull    a8, a8, a9
    movi.n  a9, 10
    mull    a10, a6, a9
    bgeu    a8, a10, .Lstate_tired
    movi.n  a4, 8
    j       .Lstate_selected
.Lstate_sleeping:
    movi.n  a4, 2
    j       .Lstate_selected
.Lstate_waiting:
    movi.n  a4, 3
    j       .Lstate_selected
.Lstate_hatching:
    movi.n  a4, 1
    j       .Lstate_selected
.Lstate_fire:
    movi.n  a4, 4
    j       .Lstate_selected
.Lstate_zooming:
    movi.n  a4, 5
    j       .Lstate_selected
.Lstate_happy:
    movi.n  a4, 6
    j       .Lstate_selected
.Lstate_tired:
    movi.n  a4, 7
.Lstate_selected:
    s32i    a4, a7, 100

    l32i    a8, a7, 88
    beqz    a8, .Lrender_stats
    mov     a4, a8
    l32r    a8, .Lcurrent_format_0
    s32i    a8, a1, 16
    l32r    a8, .Lcurrent_format_1
    s32i    a8, a1, 20
    addi    a10, a1, 32
    movi.n  a11, 16
    addi    a12, a1, 16
    mov     a13, a6
    l32r    a8, .Lsnprintf
    callx8  a8
    mov     a10, a4
    addi    a11, a1, 32
    l32r    a8, .Llabel_set_text
    callx8  a8

.Lrender_stats:
    l32i    a8, a7, 92
    beqz    a8, .Lrender_face
    mov     a4, a8
    l32r    a8, .Lstats_format_0
    s32i    a8, a1, 48
    l32r    a8, .Lstats_format_1
    s32i    a8, a1, 52
    l32r    a8, .Lstats_format_2
    s32i    a8, a1, 56
    addi    a10, a1, 64
    movi.n  a11, 32
    addi    a12, a1, 48
    mov     a13, a5
    l32i    a14, a7, 60
    l32i    a15, a7, 64
    l32i    a8, a7, 52
    bnez    a8, .Lstats_format
    movi.n  a14, 0
    movi.n  a15, 0
.Lstats_format:
    l32r    a8, .Lsnprintf
    callx8  a8
    mov     a10, a4
    addi    a11, a1, 64
    l32r    a8, .Llabel_set_text
    callx8  a8

.Lrender_face:
    l32i    a8, a7, 84
    beqz    a8, .Lrender_done
    mov     a4, a8
    l32i    a10, a7, 100
    addi    a11, a1, 96
    call8   stage3d_write_face
    mov     a10, a4
    addi    a11, a1, 96
    l32r    a8, .Llabel_set_text
    callx8  a8
.Lrender_done:
    retw.n
    .size stage3d_sample_and_render, . - stage3d_sample_and_render

/* Slot 6: one UI writer consumes activityEpoch and maintains idle/session. */
    .balign 4
    .global stage3d_wpm_ui_refresh
    .type stage3d_wpm_ui_refresh, @function
stage3d_wpm_ui_refresh:
    entry   a1, 48
    mov     a7, a2

    l32i    a8, a7, 68
    beqz    a8, .Lcelebration_done
    addi    a8, a8, -1
    s32i    a8, a7, 68
.Lcelebration_done:
    l32i    a6, a7, 36
    l32i    a8, a7, 40
    beq     a6, a8, .Lactivity_idle

    l32i    a5, a7, 32
    l32i    a8, a7, 72
    beqz    a8, .Lactivity_new_session
    l32r    a8, .Lsession_reset_ticks
    bltu    a5, a8, .Lactivity_wake
.Lactivity_new_session:
    mov     a10, a7
    call8   stage3d_reset_session
    l32i    a6, a7, 36
.Lactivity_wake:
    s32i    a6, a7, 40
    movi.n  a8, 0
    s32i    a8, a7, 32
    movi.n  a8, 1
    s32i    a8, a7, 72
    j       .Lsession_tick

.Lactivity_idle:
    l32i    a8, a7, 72
    beqz    a8, .Ldivider_tick
    l32i    a5, a7, 32
    l32r    a8, .Lsession_reset_ticks
    bgeu    a5, a8, .Lsession_tick
    addi    a5, a5, 1
    s32i    a5, a7, 32

.Lsession_tick:
    l32i    a8, a7, 72
    beqz    a8, .Ldivider_tick
    l32i    a8, a7, 44
    addi    a8, a8, 1
    s32i    a8, a7, 44

.Ldivider_tick:
    l32i.n  a8, a7, 28
    addi    a8, a8, 1
    bltui   a8, 5, .Lrefresh_not_due
    movi.n  a8, 0
    s32i.n  a8, a7, 28
    mov     a10, a7
    call8   stage3d_sample_and_render
    retw.n
.Lrefresh_not_due:
    s32i.n  a8, a7, 28
    retw.n
    .size stage3d_wpm_ui_refresh, . - stage3d_wpm_ui_refresh

/* Stock-first key hook; +36 is touched only for pressed keys on screen 7. */
    .balign 4
    .global stage3d_key_callback_wrapper
    .type stage3d_key_callback_wrapper, @function
stage3d_key_callback_wrapper:
    entry   a1, 32
    mov     a10, a2
    mov     a11, a3
    mov     a12, a4
    l32r    a8, .Loriginal_key_callback
    callx8  a8
    mov     a5, a10

    beqz    a4, .Lkey_done
    l8ui    a8, a4, 0
    beqz    a8, .Lkey_done
    l32r    a8, .Lscreen_manager_object
    l32i    a6, a8, 12
    beqz    a6, .Lkey_done
    l32i.n  a8, a6, 0
    beqz    a8, .Lkey_done
    l32i    a8, a8, 32
    l32r    a9, .Lvtable_slot_8
    bne     a8, a9, .Lkey_done
    memw
    l32i    a8, a6, 36
    addi    a8, a8, 1
    s32i    a8, a6, 36
    memw
.Lkey_done:
    mov     a2, a5
    retw.n
    .size stage3d_key_callback_wrapper, . - stage3d_key_callback_wrapper

    .balign 4
