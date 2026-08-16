/*
 * Framer F1 0.4.1 renderer screen ID26 registration-only module.
 *
 * ABI: renderer_id26_registration_chain and renderer_id26_register receive
 * a2=registry, a3=navigation. The chain first calls the exact frozen WPM ID7
 * registration entry, then independently attempts ID26. It never owns stock
 * setup. F1WB/F1SC/F1GA/F1RA bytes are admitted only from RAM.
 */

    .section .literal.renderer_id26, "a", @progbits
    .balign 4
.Lr_wpm_register:              .long 0x421170cc
.Lr_operator_new:              .long 0x420e7c04
.Lr_memset:                    .long 0x400011e8
.Lr_base_vtable:               .long 0x3c1acc34
.Lr_add_controller:            .long 0x4204da84
.Lr_add_navigation_id:         .long 0x420293a8
.Lr_image_create:              .long 0x420ae8a0
.Lr_image_set_src:             .long 0x420aeef0
.Lr_object_align:              .long 0x4204f0d0
.Lr_root_bg_color:             .long 0x4204ef10
.Lr_root_bg_opa:               .long 0x4204efd0
.Lr_input_singleton_getter:    .long 0x4200c4c0
.Lr_fn_pressed_getter:         .long 0x4210bfac
.Lr_controller_bytes:          .long 256
.Lr_state_bytes:               .long 62024
.Lr_desc_word_0:               .long 0x00001219
.Lr_desc_word_1:               .long 0x01360064
.Lr_desc_word_2:               .long 0x000000c8
.Lr_desc_data_bytes:           .long 62000
.Lr_magic_f1wb:                .long 0x42573146
.Lr_magic_f1sc:                .long 0x43533146
.Lr_magic_f1ga:                .long 0x41473146
.Lr_magic_f1ra:                .long 0x41523146
.Lr_color_slot_0:              .long 0x00000861
.Lr_color_slot_1:              .long 0x0000c9e7
.Lr_color_slot_2:              .long 0x00001355

.Lr_vtable_slot_0:             .long 0x4204d5dc
.Lr_vtable_slot_1:             .long renderer_id26_build
.Lr_vtable_slot_2:             .long 0x4204d694
.Lr_vtable_slot_3:             .long 0x4210882c
.Lr_vtable_slot_4:             .long renderer_id26_cleanup
.Lr_vtable_slot_5:             .long 0x4204d6d0
.Lr_vtable_slot_6:             .long renderer_id26_ui_refresh
.Lr_vtable_slot_7:             .long 0x42108834
.Lr_vtable_slot_8:             .long renderer_id26_id
.Lr_vtable_slot_9:             .long renderer_id26_encoder
.Lr_vtable_slot_10:            .long 0x42108844

    .section .text.renderer_id26, "ax", @progbits
    .balign 4

    .global renderer_id26_registration_chain
    .type renderer_id26_registration_chain, @function
renderer_id26_registration_chain:
    entry   a1, 48
    mov     a4, a2
    mov     a5, a3
    mov     a10, a4
    mov     a11, a5
    l32r    a8, .Lr_wpm_register
    callx8  a8
    mov     a10, a4
    mov     a11, a5
    call8   renderer_id26_register
    retw.n
    .size renderer_id26_registration_chain, . - renderer_id26_registration_chain

/* a2=registry,a3=navigation; returns controller/null in a2. */
    .balign 4
    .global renderer_id26_register
    .type renderer_id26_register, @function
renderer_id26_register:
    entry   a1, 64
    mov     a7, a2
    mov     a6, a3
    beqz    a7, .Lr_register_failed
    beqz    a6, .Lr_register_failed

    l32r    a10, .Lr_controller_bytes
    l32r    a8, .Lr_operator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lr_register_failed
    mov     a10, a5
    movi.n  a11, 0
    l32r    a12, .Lr_controller_bytes
    l32r    a8, .Lr_memset
    callx8  a8

    l32r    a10, .Lr_state_bytes
    l32r    a8, .Lr_operator_new
    callx8  a8
    mov     a4, a10
    beqz    a4, .Lr_register_failed
    mov     a10, a4
    movi.n  a11, 0
    l32r    a12, .Lr_state_bytes
    l32r    a8, .Lr_memset
    callx8  a8
    s32i    a4, a5, 56

    l32r    a8, .Lr_desc_word_0
    s32i.n  a8, a4, 0
    l32r    a8, .Lr_desc_word_1
    s32i.n  a8, a4, 4
    l32r    a8, .Lr_desc_word_2
    s32i.n  a8, a4, 8
    l32r    a8, .Lr_desc_data_bytes
    s32i    a8, a4, 12
    addi    a8, a4, 24
    s32i    a8, a4, 16
    movi.n  a8, 0
    s32i    a8, a4, 20

    l32r    a8, .Lr_base_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26
    movi.n  a8, -1
    s32i    a8, a5, 68
    movi.n  a8, 1
    s32i    a8, a5, 72

    addi    a9, a5, 160
    l32r    a8, .Lr_vtable_slot_0
    s32i    a8, a9, 0
    l32r    a8, .Lr_vtable_slot_1
    s32i    a8, a9, 4
    l32r    a8, .Lr_vtable_slot_2
    s32i    a8, a9, 8
    l32r    a8, .Lr_vtable_slot_3
    s32i    a8, a9, 12
    l32r    a8, .Lr_vtable_slot_4
    s32i    a8, a9, 16
    l32r    a8, .Lr_vtable_slot_5
    s32i    a8, a9, 20
    l32r    a8, .Lr_vtable_slot_6
    s32i    a8, a9, 24
    l32r    a8, .Lr_vtable_slot_7
    s32i    a8, a9, 28
    l32r    a8, .Lr_vtable_slot_8
    s32i    a8, a9, 32
    l32r    a8, .Lr_vtable_slot_9
    s32i    a8, a9, 36
    l32r    a8, .Lr_vtable_slot_10
    s32i    a8, a9, 40
    s32i.n  a9, a5, 0

    mov     a10, a7
    mov     a11, a5
    l32r    a8, .Lr_add_controller
    callx8  a8
    l32i    a8, a5, 20
    bne     a8, a7, .Lr_register_failed
    mov     a10, a6
    movi    a11, 26
    l32r    a8, .Lr_add_navigation_id
    callx8  a8
    mov     a2, a5
    retw.n
.Lr_register_failed:
    movi.n  a2, 0
    retw.n
    .size renderer_id26_register, . - renderer_id26_register

/* a2=controller; fills the sole 100x310 RGB565 RAM framebuffer. */
    .balign 4
    .type renderer_id26_render_slot, @function
renderer_id26_render_slot:
    entry   a1, 32
    l32i    a7, a2, 56
    beqz    a7, .Lr_render_done
    l32i    a6, a2, 64
    l32r    a8, .Lr_color_slot_0
    beqz    a6, .Lr_render_color_ready
    movi.n  a9, 1
    l32r    a8, .Lr_color_slot_1
    beq     a6, a9, .Lr_render_color_ready
    l32r    a8, .Lr_color_slot_2
.Lr_render_color_ready:
    addi    a7, a7, 24
    movi    a6, 31000
.Lr_render_loop:
    s16i    a8, a7, 0
    addi.n  a7, a7, 2
    addi.n  a6, a6, -1
    bnez    a6, .Lr_render_loop
    memw
.Lr_render_done:
    retw.n
    .size renderer_id26_render_slot, . - renderer_id26_render_slot

    .balign 4
    .global renderer_id26_build
    .type renderer_id26_build, @function
renderer_id26_build:
    entry   a1, 48
    mov     a7, a2
    mov     a10, a7
    call8   renderer_id26_render_slot
    l32i.n  a10, a7, 12
    movi.n  a11, 0
    movi.n  a12, 0
    l32r    a8, .Lr_root_bg_color
    callx8  a8
    l32i.n  a10, a7, 12
    movi    a11, 255
    movi.n  a12, 0
    l32r    a8, .Lr_root_bg_opa
    callx8  a8
    l32i.n  a10, a7, 12
    l32r    a8, .Lr_image_create
    callx8  a8
    mov     a6, a10
    beqz    a6, .Lr_build_done
    l32i    a11, a7, 56
    l32r    a8, .Lr_image_set_src
    callx8  a8
    mov     a10, a6
    movi.n  a11, 9
    movi.n  a12, 0
    movi.n  a13, 0
    l32r    a8, .Lr_object_align
    callx8  a8
    s32i    a6, a7, 60
    l32i    a8, a7, 64
    s32i    a8, a7, 68
    movi.n  a8, 0
    s32i    a8, a7, 72
.Lr_build_done:
    retw.n
    .size renderer_id26_build, . - renderer_id26_build

    .balign 4
    .global renderer_id26_ui_refresh
    .type renderer_id26_ui_refresh, @function
renderer_id26_ui_refresh:
    entry   a1, 48
    mov     a7, a2
    l32i    a8, a7, 72
    bnez    a8, .Lr_refresh_apply
    l32i    a8, a7, 64
    l32i    a9, a7, 68
    beq     a8, a9, .Lr_refresh_done
.Lr_refresh_apply:
    mov     a10, a7
    call8   renderer_id26_render_slot
    l32i    a10, a7, 60
    beqz    a10, .Lr_refresh_done
    l32i    a11, a7, 56
    l32r    a8, .Lr_image_set_src
    callx8  a8
    l32i    a8, a7, 64
    s32i    a8, a7, 68
    movi.n  a8, 0
    s32i    a8, a7, 72
.Lr_refresh_done:
    retw.n
    .size renderer_id26_ui_refresh, . - renderer_id26_ui_refresh

    .balign 4
    .global renderer_id26_cleanup
    .type renderer_id26_cleanup, @function
renderer_id26_cleanup:
    entry   a1, 32
    movi.n  a8, 0
    s32i    a8, a2, 60
    movi.n  a8, -1
    s32i    a8, a2, 68
    movi.n  a8, 1
    s32i    a8, a2, 72
    retw.n
    .size renderer_id26_cleanup, . - renderer_id26_cleanup

    .balign 4
    .global renderer_id26_id
    .type renderer_id26_id, @function
renderer_id26_id:
    entry   a1, 32
    movi.n  a2, 26
    retw.n
    .size renderer_id26_id, . - renderer_id26_id

    .balign 4
    .global renderer_id26_encoder
    .type renderer_id26_encoder, @function
renderer_id26_encoder:
    entry   a1, 48
    mov     a7, a2
    movi.n  a8, 1
    bne     a3, a8, .Lr_encoder_done
    sext    a6, a4, 7
    beqz    a6, .Lr_encoder_done
    l32r    a8, .Lr_input_singleton_getter
    callx8  a8
    beqz    a10, .Lr_encoder_done
    l32r    a8, .Lr_fn_pressed_getter
    callx8  a8
    beqz    a10, .Lr_encoder_done
    l32i    a5, a7, 64
    movi.n  a8, 1
    blt     a6, a8, .Lr_encoder_previous
    addi.n  a5, a5, 1
    movi.n  a8, 3
    blt     a5, a8, .Lr_encoder_store
    movi.n  a5, 0
    j       .Lr_encoder_store
.Lr_encoder_previous:
    bnez    a5, .Lr_encoder_decrement
    movi.n  a5, 2
    j       .Lr_encoder_store
.Lr_encoder_decrement:
    addi.n  a5, a5, -1
.Lr_encoder_store:
    s32i    a5, a7, 64
    movi.n  a8, 1
    s32i    a8, a7, 72
.Lr_encoder_done:
    retw.n
    .size renderer_id26_encoder, . - renderer_id26_encoder

/*
 * a2=RAM F1WB pointer,a3=length; returns 1/0. This is the strict structural
 * admission boundary used after a transaction-level SHA-256 verification.
 * It validates canonical F1WB and nested F1SC/F1GA/F1RA magic/layout/bounds.
 */
    .balign 4
    .global renderer_id26_admit_f1wb
    .type renderer_id26_admit_f1wb, @function
renderer_id26_admit_f1wb:
    entry   a1, 96
    mov     a7, a2
    mov     a6, a3
    beqz    a7, .Lr_admit_failed
    movi    a8, 332
    bltu    a6, a8, .Lr_admit_failed
    l32i.n  a8, a7, 0
    l32r    a9, .Lr_magic_f1wb
    bne     a8, a9, .Lr_admit_failed
    l8ui    a8, a7, 4
    movi.n  a9, 1
    bne     a8, a9, .Lr_admit_failed
    l8ui    a8, a7, 5
    movi.n  a9, 3
    bne     a8, a9, .Lr_admit_failed
    l8ui    a5, a7, 6
    beqz    a5, .Lr_admit_failed
    bltu    a9, a5, .Lr_admit_failed
    l8ui    a8, a7, 7
    bgeu    a8, a5, .Lr_admit_failed
    l32i    a8, a7, 12
    bne     a8, a6, .Lr_admit_failed
    l16ui   a8, a7, 16
    movi.n  a9, 104
    bne     a8, a9, .Lr_admit_failed
    l16ui   a8, a7, 18
    movi    a9, 332
    bne     a8, a9, .Lr_admit_failed

    addi    a4, a7, 20
.Lr_admit_slot:
    l8ui    a8, a4, 0
    movi.n  a9, 1
    bne     a8, a9, .Lr_admit_failed
    l8ui    a3, a4, 1
    beqz    a3, .Lr_admit_failed
    movi.n  a8, 2
    bltu    a8, a3, .Lr_admit_failed
    l8ui    a8, a4, 2
    beqz    a8, .Lr_admit_failed
    movi.n  a9, 16
    bltu    a9, a8, .Lr_admit_failed
    l8ui    a8, a4, 3
    bnez    a8, .Lr_admit_failed
    l32i.n  a8, a4, 4
    l32i.n  a9, a4, 8
    beqz    a9, .Lr_admit_failed
    movi    a10, 332
    bltu    a8, a10, .Lr_admit_failed
    add     a11, a8, a9
    bltu    a11, a8, .Lr_admit_failed
    bltu    a6, a11, .Lr_admit_failed
    add     a10, a7, a8
    l32i.n  a11, a10, 0
    movi.n  a8, 1
    beq     a3, a8, .Lr_admit_semantic
    l32r    a8, .Lr_magic_f1ra
    bne     a11, a8, .Lr_admit_failed
    l32i    a8, a4, 12
    bnez    a8, .Lr_admit_failed
    l32i    a8, a4, 16
    bnez    a8, .Lr_admit_failed
    l8ui    a8, a10, 4
    movi.n  a11, 1
    bne     a8, a11, .Lr_admit_failed
    l8ui    a8, a10, 5
    bne     a8, a11, .Lr_admit_failed
    l16ui   a8, a10, 6
    movi.n  a11, 100
    bne     a8, a11, .Lr_admit_failed
    l16ui   a8, a10, 8
    movi    a11, 310
    bne     a8, a11, .Lr_admit_failed
    j       .Lr_admit_next
.Lr_admit_semantic:
    l32r    a8, .Lr_magic_f1sc
    bne     a11, a8, .Lr_admit_failed
    l8ui    a8, a10, 4
    movi.n  a11, 1
    bne     a8, a11, .Lr_admit_failed
    l8ui    a8, a10, 5
    movi.n  a11, 100
    bne     a8, a11, .Lr_admit_failed
    l16ui   a8, a10, 6
    movi    a11, 310
    bne     a8, a11, .Lr_admit_failed
    l32i    a8, a4, 12
    l32i    a9, a4, 16
    beqz    a8, .Lr_admit_failed
    beqz    a9, .Lr_admit_failed
    add     a11, a8, a9
    bltu    a11, a8, .Lr_admit_failed
    bltu    a6, a11, .Lr_admit_failed
    add     a10, a7, a8
    l32i.n  a11, a10, 0
    l32r    a8, .Lr_magic_f1ga
    bne     a11, a8, .Lr_admit_failed
    l8ui    a8, a10, 4
    movi.n  a11, 1
    bne     a8, a11, .Lr_admit_failed
    l8ui    a8, a10, 5
    movi.n  a11, 1
    bne     a8, a11, .Lr_admit_failed
.Lr_admit_next:
    addi    a4, a4, 104
    addi.n  a5, a5, -1
    bnez    a5, .Lr_admit_slot
    movi.n  a2, 1
    retw.n
.Lr_admit_failed:
    movi.n  a2, 0
    retw.n
    .size renderer_id26_admit_f1wb, . - renderer_id26_admit_f1wb
