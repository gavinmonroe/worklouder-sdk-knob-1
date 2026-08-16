/*
 * Framer F1 0.4.1 Stage-3E.3A corrected I4 decoder canary.
 *
 * This is intentionally one rung above the live-proven Stage-3C.1 screen:
 * - screen ID 7 and the C1-owned WPM labels remain unchanged;
 * - the root gets an opaque dark-blue background;
 * - one static, screen-owned 52x42 LVGL I4 image is created;
 * - there is no source switch, sky bitmap, species input, star field, or hook.
 */

    .section .literal.stage3e3a_i4, "a", @progbits
    .balign 4
.Loriginal_screen_setup:     .long 0x4202c108
.Lroot_registry_getter:      .long 0x42004e1c
.Lregistry_from_root:        .long 0x4210ad9c
.Lscreen_manager_getter:     .long 0x42006888
.Loperator_new:              .long 0x420e7c04
.Lmemset:                    .long 0x400011e8
.Lbase_vtable:               .long 0x3c1acc34
.Ladd_controller:            .long 0x4204da84
.Ladd_navigation_id:         .long 0x420293a8

.Lvtable_slot_0:             .long 0x4204d5dc
.Lvtable_slot_1:             .long stage3e3a_wpm_show
.Lvtable_slot_2:             .long 0x4204d694
.Lvtable_slot_3:             .long 0x4210882c
.Lvtable_slot_4:             .long stage3e3a_wpm_cleanup
.Lvtable_slot_5:             .long 0x4204d6d0
.Lvtable_slot_6:             .long stage3e3a_wpm_ui_refresh
.Lvtable_slot_7:             .long 0x42108834
.Lvtable_slot_8:             .long stage3e3a_wpm_id
.Lvtable_slot_9:             .long 0x4210883c
.Lvtable_slot_10:            .long 0x42108844

.Lroot_bg_color:             .long 0x4204ef10
.Lroot_bg_opa:               .long 0x4204efd0
.Lnight_blue:                .long 0x0006152b
.Limage_create:              .long 0x420ae8a0
.Limage_set_src:             .long 0x420aeef0
.Lobject_align:              .long 0x4204f0d0
.Lcat_descriptor:            .long 0x3c1c1190

/* Exact live Stage-3C.1 label/data path. */
.Llabel_create:              .long 0x4204f170
.Llabel_set_font:            .long 0x4204f018
.Llabel_align:               .long 0x4204f0d0
.Llabel_set_text:            .long 0x4204ee30
.Ltitle_font:                .long 0x3c18e960
.Lwpm_label:                 .long 0x3c12e738
.Lok_value:                  .long 0x3c12eaf7
.Lsnprintf:                  .long 0x420f896c
.Lunsigned_format:           .long 0x3c1258d8
.Lwpm_current:               .long 0x3fcaba20

    .section .text.stage3e3a_i4, "ax", @progbits
    .balign 4

    .global stage3e3a_screen_setup_wrapper
    .type stage3e3a_screen_setup_wrapper, @function
stage3e3a_screen_setup_wrapper:
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

    l32r    a8, .Lbase_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26
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
    mov     a10, a6
    movi.n  a11, 7
    l32r    a8, .Ladd_navigation_id
    callx8  a8
.Lsetup_done:
    mov     a2, a4
    retw.n
    .size stage3e3a_screen_setup_wrapper, . - stage3e3a_screen_setup_wrapper

    .balign 4
    .global stage3e3a_wpm_show
    .type stage3e3a_wpm_show, @function
stage3e3a_wpm_show:
    entry   a1, 48
    mov     a5, a2
    movi.n  a8, 4
    s32i.n  a8, a5, 28
    movi.n  a8, 0
    s32i.n  a8, a5, 32

    /* The common screen root already exists at controller +12. */
    l32i.n  a10, a5, 12
    l32r    a11, .Lnight_blue
    movi.n  a12, 0
    l32r    a8, .Lroot_bg_color
    callx8  a8
    l32i.n  a10, a5, 12
    movi    a11, 255
    movi.n  a12, 0
    l32r    a8, .Lroot_bg_opa
    callx8  a8

    /* One static I4 source. No cache accumulation or source-switch path. */
    l32i.n  a10, a5, 12
    l32r    a8, .Limage_create
    callx8  a8
    mov     a6, a10
    s32i.n  a6, a5, 44
    beqz    a6, .Lbuild_labels
    mov     a10, a6
    l32r    a11, .Lcat_descriptor
    l32r    a8, .Limage_set_src
    callx8  a8
    mov     a10, a6
    movi.n  a11, 9
    movi.n  a12, 0
    movi.n  a13, 0
    l32r    a8, .Lobject_align
    callx8  a8

.Lbuild_labels:
    /* From here through the second label, retain the live C1 call sequence. */
    l32i.n  a10, a5, 12
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a7, a10
    s32i.n  a10, a5, 36
    mov     a10, a7
    l32r    a11, .Ltitle_font
    movi.n  a12, 0
    l32r    a8, .Llabel_set_font
    callx8  a8
    mov     a10, a7
    movi.n  a11, 2
    movi.n  a12, 0
    movi.n  a13, 15
    l32r    a8, .Llabel_align
    callx8  a8
    mov     a10, a7
    l32r    a11, .Lwpm_label
    l32r    a8, .Llabel_set_text
    callx8  a8

    l32i.n  a10, a5, 12
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a6, a10
    s32i.n  a10, a5, 40
    mov     a10, a6
    l32r    a11, .Ltitle_font
    movi.n  a12, 0
    l32r    a8, .Llabel_set_font
    callx8  a8
    mov     a10, a6
    movi.n  a11, 2
    movi.n  a12, 0
    movi.n  a13, 38
    l32r    a8, .Llabel_align
    callx8  a8
    mov     a10, a6
    l32r    a11, .Lok_value
    l32r    a8, .Llabel_set_text
    callx8  a8
    retw.n
    .size stage3e3a_wpm_show, . - stage3e3a_wpm_show

    .balign 4
    .global stage3e3a_wpm_cleanup
    .type stage3e3a_wpm_cleanup, @function
stage3e3a_wpm_cleanup:
    entry   a1, 32
    movi.n  a8, 0
    s32i.n  a8, a2, 36
    s32i.n  a8, a2, 40
    s32i.n  a8, a2, 44
    retw.n
    .size stage3e3a_wpm_cleanup, . - stage3e3a_wpm_cleanup

    .balign 4
    .global stage3e3a_wpm_id
    .type stage3e3a_wpm_id, @function
stage3e3a_wpm_id:
    entry   a1, 32
    movi.n  a2, 7
    retw.n
    .size stage3e3a_wpm_id, . - stage3e3a_wpm_id

    .balign 4
    .global stage3e3a_wpm_ui_refresh
    .type stage3e3a_wpm_ui_refresh, @function
stage3e3a_wpm_ui_refresh:
    entry   a1, 48
    l32i.n  a8, a2, 32
    addi    a8, a8, 1
    s32i.n  a8, a2, 32
    l32i.n  a8, a2, 28
    addi    a8, a8, 1
    bltui   a8, 5, .Lrefresh_not_due
    movi.n  a8, 0
    s32i.n  a8, a2, 28
    l32i.n  a7, a2, 40
    beqz    a7, .Lrefresh_done
    l32r    a8, .Lwpm_current
    lsi     f0, a8, 0
    utrunc.s a13, f0, 0
    l32r    a12, .Lunsigned_format
    movi.n  a11, 8
    addi    a10, a1, 4
    l32r    a8, .Lsnprintf
    callx8  a8
    mov     a10, a7
    addi    a11, a1, 4
    l32r    a8, .Llabel_set_text
    callx8  a8
.Lrefresh_done:
    retw.n
.Lrefresh_not_due:
    s32i.n  a8, a2, 28
    retw.n
    .size stage3e3a_wpm_ui_refresh, . - stage3e3a_wpm_ui_refresh

    .balign 4
