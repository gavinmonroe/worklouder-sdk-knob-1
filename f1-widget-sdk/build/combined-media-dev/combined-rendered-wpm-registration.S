/*
 * Framer F1 0.4.1 Stage-3E.3.4 native WPM sprite screen.
 *
 * OFFLINE ABI INPUT ONLY. This screen starts from the exact live Stage-3C.1
 * base, restores/retains the stock key callback, and owns one fail-visible
 * LVGL I4 image switched to a 96x78 RAM frame, labels, and star labels.
 * Every runtime-read asset byte stays inside the factory-mapped DROM page.
 */

    .section .literal.stage3e34_setup, "a", @progbits
    .balign 4
.Loriginal_screen_setup:       .long 0x4202c108
.Lroot_registry_getter:        .long 0x42004e1c
.Lregistry_from_root:          .long 0x4210ad9c
.Lscreen_manager_getter:       .long 0x42006888

    .section .literal.stage3e34_wpm_sprite, "a", @progbits
    .balign 4
.Loperator_new:                .long 0x420e7c04
.Lmemset:                      .long 0x400011e8
.Lbase_vtable:                 .long 0x3c1acc34
.Ladd_controller:              .long 0x4204da84
.Ladd_navigation_id:           .long 0x420293a8

/* Eleven-word controller vtable copied into object +160. */
.Lvtable_slot_0:               .long 0x4204d5dc
.Lvtable_slot_1:               .long stage3e34_wpm_build
.Lvtable_slot_2:               .long 0x4204d694
.Lvtable_slot_3:               .long 0x4210882c
.Lvtable_slot_4:               .long stage3e34_wpm_cleanup
.Lvtable_slot_5:               .long 0x4204d6d0
.Lvtable_slot_6:               .long stage3e34_wpm_ui_refresh
.Lvtable_slot_7:               .long 0x42108834
.Lvtable_slot_8:               .long stage3e34_wpm_id
.Lvtable_slot_9:               .long stage3e34_wpm_encoder
.Lvtable_slot_10:              .long 0x42108844

/* Stock LVGL wrappers pinned from the official 0.4.1 image. */
.Limage_create:                .long 0x420ae8a0
.Limage_set_src:               .long 0x420aeef0
.Lcanary_descriptor_0:         .long 0x3c1c1190
.Lcontroller_bytes:            .long 7872
.Lobject_align:                .long 0x4204f0d0
.Llabel_create:                .long 0x4204f170
.Llabel_set_font:              .long 0x4204f018
.Llabel_set_text:              .long 0x4204ee30
.Llabel_set_color:             .long 0x4204ef44
.Lsmall_font_ascii:            .long 0x3c18e960
.Llarge_font_ascii:            .long 0x3c18ceac
.Lsnprintf:                    .long 0x420f896c
.Lwpm_current:                 .long 0x3fcaba20
.Lsample_rebase_count:         .long 65536
.Linput_singleton_getter:      .long 0x4200c4c0
.Lfn_pressed_getter:           .long 0x4210bfac
.Lroot_bg_color:               .long 0x4204ef10
.Lroot_bg_opa:                 .long 0x4204efd0

/* Full table follows the exact live E3A canary descriptor/payload. */
.Lpet_descriptor_0:            .long 0x3c1c162c
.Lram_desc_word_0:             .long 0x00000919
.Lram_desc_word_4:             .long 0x004e0060
.Lram_desc_word_8:             .long 0x00000030
.Lram_desc_data_bytes:         .long 3808
.Lsrc_desc_word_4:             .long 0x002a0034
.Lram_bank_stride:             .long 3832

/* LVGL 24-bit colors are passed as 0xRRGGBB. */
.Lnight_blue:                  .long 0x06152b
.Lstar_dim:                    .long 0x456ba8
.Lstar_bright:                 .long 0xffffff
.Lcolor_ready:                 .long 0x8fb8ff
.Lcolor_low:                   .long 0x79a6ff
.Lcolor_medium:                .long 0x63e6ff
.Lcolor_high:                  .long 0xffee88

/* New strings are copied from IROM literal words to stack before use. */
.Lwpm_initial_0:               .long 0x00000030 /* "0\0" */
.Lstats_initial_0:             .long 0x20677641 /* "Avg " */
.Lstats_initial_1:             .long 0x6f540a30 /* "0\nTo" */
.Lstats_initial_2:             .long 0x30203a70 /* "p: 0" */
.Lstats_initial_3:             .long 0x00000000
.Lwpm_format_0:                .long 0x00007525 /* "%u\0" */
.Lstats_format_0:              .long 0x20677641 /* "Avg " */
.Lstats_format_1:              .long 0x540a7525 /* "%u\nT" */
.Lstats_format_2:              .long 0x203a706f /* "op: " */
.Lstats_format_3:              .long 0x00007525 /* "%u\0" */

    .section .text.stage3e34_wpm_sprite, "ax", @progbits
    .balign 4

/*
 * Controller layout (7872-byte allocation):
 * +0..+27 common     +28 sampleDivider      +32 twinkleDivider
 * +36 petState       +40 reserved           +44 currentRounded
 * +48 sampleCount    +52 sampleSum          +56 sessionHigh
 * +60 sessionLow     +64 averageRounded     +68 previousWpm
 * +72 idleSamples    +76 celebrationSamples +80 everActive
 * +84 petImage       +88 wpmLabel            +92 statsLabel
 * +96/+100/+104 star labels                  +108 lastRenderedWpm
 * +112 lastRenderedAvg +116 lastRenderedHigh +120 lastColorBand
 * +124 selectedSpecies +128 renderedSpecies  +132 renderedState
 * +136 starPhase     +140 reserved            +144 activeRAM +148..+159
 * +160..+203 vtable; +208 descA; +232 dataA; +4040 descB; +4064 dataB
 */

    .section .text.stage3e34_setup, "ax", @progbits
    .balign 4
    .global stage3e34_screen_setup_wrapper
    .type stage3e34_screen_setup_wrapper, @function
stage3e34_screen_setup_wrapper:
    entry   a1, 64

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

    mov     a10, a7
    mov     a11, a6
    call8   stage3e34_register_wpm
.Lsetup_done:
    mov     a2, a4
    retw.n
    .size stage3e34_screen_setup_wrapper, . - stage3e34_screen_setup_wrapper

/* Registration-only combined-widget ABI: a2=registry,a3=navigation; returns controller/null. */
    .section .text.stage3e34_wpm_sprite, "ax", @progbits
    .balign 4
    .global stage3e34_register_wpm
    .type stage3e34_register_wpm, @function
stage3e34_register_wpm:
    entry   a1, 48
    mov     a7, a2
    mov     a6, a3
    beqz    a7, .Lregister_failed
    beqz    a6, .Lregister_failed
    l32r    a10, .Lcontroller_bytes
    l32r    a8, .Loperator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lregister_failed

    mov     a10, a5
    movi.n  a11, 0
    l32r    a12, .Lcontroller_bytes
    l32r    a8, .Lmemset
    callx8  a8

    l32r    a8, .Lbase_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26
    movi.n  a8, 4                       /* Default species is the blue cat. */
    s32i    a8, a5, 124

    addi    a9, a5, 160
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
    l32i    a8, a5, 20
    bne     a8, a7, .Lregister_failed

    mov     a10, a6
    movi.n  a11, 7
    l32r    a8, .Ladd_navigation_id
    callx8  a8
    mov     a2, a5
    retw.n
.Lregister_failed:
    movi.n  a2, 0
    retw.n
    .size stage3e34_register_wpm, . - stage3e34_register_wpm

/* a2=parent, a3=descriptor, a4=center-y; returns image in a2. */
    .balign 4
    .type stage3e34_make_image, @function
stage3e34_make_image:
    entry   a1, 48
    mov     a6, a3
    mov     a7, a4
    mov     a10, a2
    l32r    a8, .Limage_create
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lmake_image_done

    mov     a10, a5
    mov     a11, a6
    l32r    a8, .Limage_set_src
    callx8  a8

    mov     a10, a5
    movi.n  a11, 9
    movi.n  a12, 0
    mov     a13, a7
    l32r    a8, .Lobject_align
    callx8  a8
.Lmake_image_done:
    mov     a2, a5
    retw.n
    .size stage3e34_make_image, . - stage3e34_make_image

/* a2=parent, a3=font, a4=y, a5=initial text, a6=align; returns label in a2. */
    .balign 4
    .type stage3e34_make_label, @function
stage3e34_make_label:
    entry   a1, 48
    mov     a7, a6
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
    mov     a11, a7
    movi.n  a12, 0
    mov     a13, a4
    l32r    a8, .Lobject_align
    callx8  a8

    mov     a10, a6
    mov     a11, a5
    l32r    a8, .Llabel_set_text
    callx8  a8
.Lmake_label_done:
    mov     a2, a6
    retw.n
    .size stage3e34_make_label, . - stage3e34_make_label

/* a2=parent,a3=x,a4=y,a5=color; returns one created-once "*" label. */
    .balign 4
    .type stage3e34_make_star, @function
stage3e34_make_star:
    entry   a1, 64
    mov     a7, a3
    mov     a6, a4
    movi.n  a8, 42
    s8i     a8, a1, 16
    movi.n  a8, 0
    s8i     a8, a1, 17
    mov     a10, a2
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a4, a10
    beqz    a4, .Lmake_star_done
    mov     a10, a4
    l32r    a11, .Lsmall_font_ascii
    movi.n  a12, 0
    l32r    a8, .Llabel_set_font
    callx8  a8
    mov     a10, a4
    movi.n  a11, 9
    mov     a12, a7
    mov     a13, a6
    l32r    a8, .Lobject_align
    callx8  a8
    mov     a10, a4
    addi    a11, a1, 16
    l32r    a8, .Llabel_set_text
    callx8  a8
    mov     a10, a4
    mov     a11, a5
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8
.Lmake_star_done:
    mov     a2, a4
    retw.n
    .size stage3e34_make_star, . - stage3e34_make_star

/* a2=controller,a3=52x42 I4 descriptor; returns inactive 96x78 RAM descriptor/null. */
    .balign 4
    .type stage3e34_expand_i4, @function
stage3e34_expand_i4:
    entry   a1, 128
    mov     a7, a2
    mov     a6, a3
    beqz    a6, .Lexpand_failed
    l32i.n  a8, a6, 0
    l32r    a9, .Lram_desc_word_0
    bne     a8, a9, .Lexpand_failed
    l32i.n  a8, a6, 4
    l32r    a9, .Lsrc_desc_word_4
    bne     a8, a9, .Lexpand_failed
    l32i.n  a8, a6, 8
    movi.n  a9, 26
    bne     a8, a9, .Lexpand_failed
    l32i    a8, a6, 12
    movi    a9, 1156
    bne     a8, a9, .Lexpand_failed
    l32i    a6, a6, 16
    beqz    a6, .Lexpand_failed

    l32i    a8, a7, 144
    movi.n  a9, 1
    xor     a8, a8, a9
    s32i    a8, a7, 144
    addi    a3, a7, 208
    beqz    a8, .Lexpand_target_ready
    l32r    a9, .Lram_bank_stride
    add     a3, a3, a9
.Lexpand_target_ready:
    addi    a5, a3, 24
    l32r    a8, .Lram_desc_word_0
    s32i.n  a8, a3, 0
    l32r    a8, .Lram_desc_word_4
    s32i.n  a8, a3, 4
    l32r    a8, .Lram_desc_word_8
    s32i.n  a8, a3, 8
    l32r    a8, .Lram_desc_data_bytes
    s32i    a8, a3, 12
    s32i    a5, a3, 16
    movi.n  a8, 0
    s32i    a8, a3, 20

    /* Preserve the exact binary-alpha BGRA palette. */
    mov     a10, a6
    mov     a11, a5
    movi.n  a12, 16
.Lexpand_palette_loop:
    l32i.n  a8, a10, 0
    s32i.n  a8, a11, 0
    addi.n  a10, a10, 4
    addi.n  a11, a11, 4
    addi.n  a12, a12, -1
    bnez    a12, .Lexpand_palette_loop
    addi    a6, a6, 64
    addi    a5, a5, 64

    movi.n  a4, 0                       /* destination y */
.Lexpand_row_loop:
    movi.n  a8, 42
    mull    a8, a4, a8
    movi.n  a9, 78
    quou    a8, a8, a9
    movi.n  a9, 26
    mull    a8, a8, a9
    add     a10, a6, a8                 /* source row */
    movi.n  a8, 48
    mull    a8, a4, a8
    add     a11, a5, a8                 /* destination row */
    movi.n  a12, 0                      /* destination x */
.Lexpand_pair_loop:
    movi.n  a8, 52
    mull    a8, a12, a8
    movi.n  a9, 96
    quou    a8, a8, a9
    srli    a9, a8, 1
    add     a9, a10, a9
    l8ui    a13, a9, 0
    bbsi    a8, 0, .Lexpand_first_low
    srli    a13, a13, 4
    j       .Lexpand_first_ready
.Lexpand_first_low:
    extui   a13, a13, 0, 4
.Lexpand_first_ready:
    addi.n  a8, a12, 1
    movi.n  a9, 52
    mull    a8, a8, a9
    movi.n  a9, 96
    quou    a8, a8, a9
    srli    a9, a8, 1
    add     a9, a10, a9
    l8ui    a14, a9, 0
    bbsi    a8, 0, .Lexpand_second_low
    srli    a14, a14, 4
    j       .Lexpand_second_ready
.Lexpand_second_low:
    extui   a14, a14, 0, 4
.Lexpand_second_ready:
    slli    a13, a13, 4
    or      a13, a13, a14
    s8i     a13, a11, 0
    addi.n  a11, a11, 1
    addi.n  a12, a12, 2
    movi.n  a8, 96
    bltu    a12, a8, .Lexpand_pair_loop
    addi.n  a4, a4, 1
    movi.n  a8, 78
    bltu    a4, a8, .Lexpand_row_loop
    mov     a2, a3
    retw.n
.Lexpand_failed:
    movi.n  a2, 0
    retw.n
    .size stage3e34_expand_i4, . - stage3e34_expand_i4

/* a2=controller,a3=desired state. Switch the one image to RAM, or DROM on failure. */
    .balign 4
    .type stage3e34_apply_pet_source, @function
stage3e34_apply_pet_source:
    entry   a1, 80
    mov     a7, a2
    mov     a6, a3
    l32i    a5, a7, 124
    movi.n  a8, 6
    bgeu    a5, a8, .Lapply_source_done
    movi.n  a8, 8
    bgeu    a6, a8, .Lapply_source_done
    l32i    a4, a7, 84
    beqz    a4, .Lapply_source_done
.Lapply_source_check_cache:
    l32i    a8, a7, 128
    l32i    a9, a7, 132
    bne     a8, a5, .Lapply_source_set_new
    beq     a9, a6, .Lapply_source_done
.Lapply_source_set_new:
    slli    a8, a5, 3
    add     a8, a8, a6
    movi.n  a9, 24
    mull    a8, a8, a9
    l32r    a11, .Lpet_descriptor_0
    add     a11, a11, a8
    mov     a3, a11
    mov     a10, a7
    mov     a11, a3
    call8   stage3e34_expand_i4
    beqz    a10, .Lapply_source_fallback
    mov     a3, a10
.Lapply_source_fallback:
    mov     a10, a4
    mov     a11, a3
    l32r    a8, .Limage_set_src
    callx8  a8
.Lapply_source_store:
    s32i    a5, a7, 128
    s32i    a6, a7, 132
.Lapply_source_done:
    retw.n
    .size stage3e34_apply_pet_source, . - stage3e34_apply_pet_source

/* Slot 1: paint root, create exact live E3A pet, metrics, then stars. */
    .balign 4
    .global stage3e34_wpm_build
    .type stage3e34_wpm_build, @function
stage3e34_wpm_build:
    entry   a1, 96
    mov     a7, a2
    movi.n  a8, 0
    s32i    a8, a7, 32
    s32i    a8, a7, 36
    s32i    a8, a7, 40
    s32i    a8, a7, 44
    s32i    a8, a7, 48
    s32i    a8, a7, 52
    s32i    a8, a7, 56
    s32i    a8, a7, 64
    s32i    a8, a7, 68
    s32i    a8, a7, 72
    s32i    a8, a7, 76
    s32i    a8, a7, 80
    s32i    a8, a7, 136
    movi.n  a8, -1
    s32i    a8, a7, 60
    s32i    a8, a7, 108
    s32i    a8, a7, 112
    s32i    a8, a7, 116
    s32i    a8, a7, 120
    s32i    a8, a7, 128
    s32i    a8, a7, 132
    movi.n  a8, 4
    s32i.n  a8, a7, 28

    /* Opaque painted background: no full-canvas bitmap or new DROM page. */
    l32i.n  a10, a7, 12
    l32r    a11, .Lnight_blue
    movi.n  a12, 0
    l32r    a8, .Lroot_bg_color
    callx8  a8
    l32i.n  a10, a7, 12
    movi    a11, 255
    movi.n  a12, 0
    l32r    a8, .Lroot_bg_opa
    callx8  a8

    l32i.n  a10, a7, 12
    l32r    a11, .Lcanary_descriptor_0  /* Exact E3A-visible cat-ready source. */
    movi.n  a12, 0
    call8   stage3e34_make_image
    s32i    a10, a7, 84

    /* Cache starts at -1, so re-entry immediately renders the persisted species. */
    mov     a10, a7
    movi.n  a11, 0
    call8   stage3e34_apply_pet_source

.Lbuild_wpm:
    l32r    a8, .Lwpm_initial_0
    s32i    a8, a1, 16
    l32i.n  a10, a7, 12
    l32r    a11, .Llarge_font_ascii
    movi.n  a12, 3
    addi    a13, a1, 16
    movi.n  a14, 2
    call8   stage3e34_make_label
    s32i    a10, a7, 88
    beqz    a10, .Lbuild_stats
    l32r    a11, .Lcolor_ready
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8

.Lbuild_stats:
    l32r    a8, .Lstats_initial_0
    s32i    a8, a1, 32
    l32r    a8, .Lstats_initial_1
    s32i    a8, a1, 36
    l32r    a8, .Lstats_initial_2
    s32i    a8, a1, 40
    l32r    a8, .Lstats_initial_3
    s32i    a8, a1, 44
    l32i.n  a10, a7, 12
    l32r    a11, .Lsmall_font_ascii
    movi.n  a12, -3
    addi    a13, a1, 32
    movi.n  a14, 5
    call8   stage3e34_make_label
    s32i    a10, a7, 92

    /* Created once. Twinkle later changes only text color, never text/source. */
    l32i.n  a10, a7, 12
    movi.n  a11, -32
    movi    a12, -102
    l32r    a13, .Lstar_bright
    call8   stage3e34_make_star
    s32i    a10, a7, 96
    l32i.n  a10, a7, 12
    movi.n  a11, 31
    movi    a12, -68
    l32r    a13, .Lstar_dim
    call8   stage3e34_make_star
    s32i    a10, a7, 100
    l32i.n  a10, a7, 12
    movi.n  a11, -29
    movi.n  a12, 82
    l32r    a13, .Lstar_bright
    call8   stage3e34_make_star
    s32i    a10, a7, 104
    retw.n
    .size stage3e34_wpm_build, . - stage3e34_wpm_build

/* Slot 4: the common root owns child deletion; clear borrowed pointers only. */
    .balign 4
    .global stage3e34_wpm_cleanup
    .type stage3e34_wpm_cleanup, @function
stage3e34_wpm_cleanup:
    entry   a1, 32
    movi.n  a8, 0
    s32i    a8, a2, 84
    s32i    a8, a2, 88
    s32i    a8, a2, 92
    s32i    a8, a2, 96
    s32i    a8, a2, 100
    s32i    a8, a2, 104
    movi.n  a8, -1
    s32i    a8, a2, 128
    s32i    a8, a2, 132
    retw.n
    .size stage3e34_wpm_cleanup, . - stage3e34_wpm_cleanup

    .balign 4
    .global stage3e34_wpm_id
    .type stage3e34_wpm_id, @function
stage3e34_wpm_id:
    entry   a1, 32
    movi.n  a2, 7
    retw.n
    .size stage3e34_wpm_id, . - stage3e34_wpm_id

/*
 * Slot 9: while this screen is active, Fn + bottom encoder cycles species.
 * Dispatcher ABI is controller, zero-extended encoder ID, zero-extended delta.
 * The dispatcher invokes slot 6 immediately after this returns, so this method
 * mutates RAM only and never calls LVGL.
 */
    .balign 4
    .global stage3e34_wpm_encoder
    .type stage3e34_wpm_encoder, @function
stage3e34_wpm_encoder:
    entry   a1, 48
    mov     a7, a2                       /* Controller survives both calls. */
    movi.n  a8, 1
    bne     a3, a8, .Lencoder_done       /* Bottom encoder only. */
    sext    a6, a4, 7
    beqz    a6, .Lencoder_done

    l32r    a8, .Linput_singleton_getter
    callx8  a8
    beqz    a10, .Lencoder_done
    l32r    a8, .Lfn_pressed_getter
    callx8  a8
    beqz    a10, .Lencoder_done

    l32i    a5, a7, 124
    movi.n  a8, 1
    blt     a6, a8, .Lencoder_previous
    addi    a5, a5, 1
    movi.n  a8, 6
    blt     a5, a8, .Lencoder_store
    movi.n  a5, 0
    j       .Lencoder_store
.Lencoder_previous:
    bnez    a5, .Lencoder_decrement
    movi.n  a5, 5
    j       .Lencoder_store
.Lencoder_decrement:
    addi    a5, a5, -1
.Lencoder_store:
    s32i    a5, a7, 124
.Lencoder_done:
    retw.n
    .size stage3e34_wpm_encoder, . - stage3e34_wpm_encoder

/*
 * 500-ms WPM/stat sampling and semantic cat-frame selection.
 *
 * The stock WPM float is the only activity signal in this first sprite proof:
 * a rise starts/resumes activity; ten non-rising samples wait; sixty sleep.
 * Frame order is ready, curious, happy, zooming, fire, tired, waiting, sleep.
 */
    .balign 4
    .type stage3e34_sample_and_render, @function
stage3e34_sample_and_render:
    entry   a1, 128
    mov     a7, a2

    l32r    a8, .Lwpm_current
    lsi     f0, a8, 0
    utrunc.s a6, f0, 0
    movi    a9, 999
    bgeu    a9, a6, .Lcurrent_clamped
    mov     a6, a9
.Lcurrent_clamped:
    s32i    a6, a7, 44

    /* Infer activity from a rising native WPM value without a global hook. */
    l32i    a8, a7, 68
    bgeu    a8, a6, .Lactivity_not_rising
    movi.n  a9, 1
    s32i    a9, a7, 80
    movi.n  a9, 0
    s32i    a9, a7, 72
    j       .Lactivity_store_previous
.Lactivity_not_rising:
    l32i    a9, a7, 80
    beqz    a9, .Lactivity_store_previous
    l32i    a9, a7, 72
    movi.n  a8, 60
    bgeu    a9, a8, .Lactivity_store_previous
    addi    a9, a9, 1
    s32i    a9, a7, 72
.Lactivity_store_previous:
    s32i    a6, a7, 68

    /* Declining residual WPM stops contributing once the cat is waiting. */
    beqz    a6, .Lstats_done
    l32i    a8, a7, 80
    beqz    a8, .Lstats_done
    l32i    a8, a7, 72
    movi.n  a9, 10
    bgeu    a8, a9, .Lstats_done
    l32i    a5, a7, 48
    l32r    a9, .Lsample_rebase_count
    bltu    a5, a9, .Lstats_after_rebase
    srli    a5, a5, 1
    l32i    a8, a7, 52
    srli    a8, a8, 1
    s32i    a5, a7, 48
    s32i    a8, a7, 52
.Lstats_after_rebase:
    bnez    a5, .Lstats_existing
    movi.n  a8, 1
    s32i    a8, a7, 48
    s32i    a6, a7, 52
    s32i    a6, a7, 56
    s32i    a6, a7, 60
    j       .Lstats_done
.Lstats_existing:
    l32i    a8, a7, 52
    add     a8, a8, a6
    s32i    a8, a7, 52
    addi    a5, a5, 1
    s32i    a5, a7, 48
    l32i    a8, a7, 56
    bgeu    a8, a6, .Lstats_low
    s32i    a6, a7, 56
    /* A mature new high celebrates for this and the next two samples. */
    bltui   a5, 4, .Lstats_low
    movi.n  a8, 3
    s32i    a8, a7, 76
.Lstats_low:
    l32i    a8, a7, 60
    bgeu    a6, a8, .Lstats_done
    s32i    a6, a7, 60

.Lstats_done:
    l32i    a8, a7, 48
    beqz    a8, .Laverage_zero
    l32i    a9, a7, 52
    quou    a5, a9, a8
    j       .Laverage_store
.Laverage_zero:
    movi.n  a5, 0
.Laverage_store:
    s32i    a5, a7, 64

    /* Waiting/sleeping are temporal states, never high-WPM bands. */
    movi.n  a4, 0                       /* ready */
    l32i    a8, a7, 80
    beqz    a8, .Lstate_selected
    l32i    a8, a7, 72
    movi.n  a9, 60
    bgeu    a8, a9, .Lstate_sleeping
    movi.n  a9, 10
    bgeu    a8, a9, .Lstate_waiting
    l32i    a8, a7, 76
    bnez    a8, .Lstate_fire
    l32i    a8, a7, 48
    movi.n  a9, 20
    bltu    a8, a9, .Lstate_not_mature
    l32i    a8, a7, 56
    beqz    a8, .Lstate_not_mature
    movi.n  a9, 10
    mull    a9, a6, a9
    movi.n  a3, 9
    mull    a8, a8, a3
    bgeu    a9, a8, .Lstate_zooming
    bltu    a6, a5, .Lstate_tired
    j       .Lstate_happy
.Lstate_not_mature:
    movi.n  a8, 40
    bgeu    a6, a8, .Lstate_happy
    movi.n  a4, 1                       /* curious */
    j       .Lstate_selected
.Lstate_happy:
    movi.n  a4, 2
    j       .Lstate_selected
.Lstate_zooming:
    movi.n  a4, 3
    j       .Lstate_selected
.Lstate_fire:
    movi.n  a4, 4
    j       .Lstate_selected
.Lstate_tired:
    movi.n  a4, 5
    j       .Lstate_selected
.Lstate_waiting:
    movi.n  a4, 6
    j       .Lstate_selected
.Lstate_sleeping:
    movi.n  a4, 7

.Lstate_selected:
    s32i    a4, a7, 36
    mov     a10, a7
    mov     a11, a4
    call8   stage3e34_apply_pet_source

.Lcelebration_tick:
    l32i    a8, a7, 76
    beqz    a8, .Lrender_wpm
    addi    a8, a8, -1
    s32i    a8, a7, 76

.Lrender_wpm:
    l32i    a8, a7, 88
    beqz    a8, .Lrender_stats
    mov     a4, a8
    l32i    a9, a7, 108
    beq     a6, a9, .Lrender_wpm_color
    s32i    a6, a7, 108
    l32r    a8, .Lwpm_format_0
    s32i    a8, a1, 16
    addi    a10, a1, 32
    movi.n  a11, 12
    addi    a12, a1, 16
    mov     a13, a6
    l32r    a8, .Lsnprintf
    callx8  a8
    mov     a10, a4
    addi    a11, a1, 32
    l32r    a8, .Llabel_set_text
    callx8  a8

.Lrealign_wpm:
    mov     a10, a4
    movi.n  a11, 2
    movi.n  a12, 0
    movi.n  a13, 3
    l32r    a8, .Lobject_align
    callx8  a8

.Lrender_wpm_color:
    movi.n  a3, 0
    beqz    a6, .Lwpm_color_band_ready
    movi.n  a3, 1
    movi.n  a9, 40
    bltu    a6, a9, .Lwpm_color_band_ready
    movi.n  a3, 2
    movi.n  a9, 80
    bltu    a6, a9, .Lwpm_color_band_ready
    movi.n  a3, 3
.Lwpm_color_band_ready:
    l32i    a8, a7, 120
    beq     a3, a8, .Lrender_stats
    s32i    a3, a7, 120
    l32r    a11, .Lcolor_ready
    beqz    a3, .Lset_wpm_color
    movi.n  a8, 1
    beq     a3, a8, .Lcolor_select_low
    movi.n  a8, 2
    beq     a3, a8, .Lcolor_select_medium
    l32r    a11, .Lcolor_high
    j       .Lset_wpm_color
.Lcolor_select_low:
    l32r    a11, .Lcolor_low
    j       .Lset_wpm_color
.Lcolor_select_medium:
    l32r    a11, .Lcolor_medium
.Lset_wpm_color:
    mov     a10, a4
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8

.Lrender_stats:
    l32i    a8, a7, 92
    beqz    a8, .Lrender_done
    mov     a4, a8
    l32i    a14, a7, 56
    l32i    a8, a7, 48
    bnez    a8, .Lstats_format
    movi.n  a14, 0
.Lstats_format:
    l32i    a8, a7, 112
    bne     a8, a5, .Lstats_cache_update
    l32i    a8, a7, 116
    beq     a8, a14, .Lrender_done
.Lstats_cache_update:
    s32i    a5, a7, 112
    s32i    a14, a7, 116
    l32r    a8, .Lstats_format_0
    s32i    a8, a1, 48
    l32r    a8, .Lstats_format_1
    s32i    a8, a1, 52
    l32r    a8, .Lstats_format_2
    s32i    a8, a1, 56
    l32r    a8, .Lstats_format_3
    s32i    a8, a1, 60
    addi    a10, a1, 64
    movi.n  a11, 32
    addi    a12, a1, 48
    mov     a13, a5
    l32r    a8, .Lsnprintf
    callx8  a8
    mov     a10, a4
    addi    a11, a1, 64
    l32r    a8, .Llabel_set_text
    callx8  a8
    mov     a10, a4
    movi.n  a11, 5
    movi.n  a12, 0
    movi.n  a13, -3
    l32r    a8, .Lobject_align
    callx8  a8
.Lrender_done:
    retw.n
    .size stage3e34_sample_and_render, . - stage3e34_sample_and_render

/* Slot 6: 100-ms LVGL callback, 1-s color twinkle and 500-ms WPM paint. */
    .balign 4
    .global stage3e34_wpm_ui_refresh
    .type stage3e34_wpm_ui_refresh, @function
stage3e34_wpm_ui_refresh:
    entry   a1, 48
    mov     a7, a2

    /* Slot 9 changes RAM only; this helper applies a changed source once. */
    mov     a10, a7
    l32i    a11, a7, 36
    call8   stage3e34_apply_pet_source

.Ltwinkle_tick:

    l32i    a8, a7, 32
    addi    a8, a8, 1
    bltui   a8, 10, .Ltwinkle_store
    movi.n  a8, 0
    s32i    a8, a7, 32
    l32i    a9, a7, 136
    movi.n  a8, 1
    xor     a9, a9, a8
    s32i    a9, a7, 136
    l32r    a5, .Lstar_dim
    l32r    a6, .Lstar_bright
    beqz    a9, .Ltwinkle_colors_ready
    mov     a8, a5
    mov     a5, a6
    mov     a6, a8
.Ltwinkle_colors_ready:
    l32i    a10, a7, 96
    beqz    a10, .Ltwinkle_star_2
    mov     a11, a6
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8
.Ltwinkle_star_2:
    l32i    a10, a7, 100
    beqz    a10, .Ltwinkle_star_3
    mov     a11, a5
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8
.Ltwinkle_star_3:
    l32i    a10, a7, 104
    beqz    a10, .Lsample_tick
    mov     a11, a6
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8
    j       .Lsample_tick
.Ltwinkle_store:
    s32i    a8, a7, 32

.Lsample_tick:
    l32i.n  a8, a7, 28
    addi    a8, a8, 1
    bltui   a8, 5, .Lsample_store
    movi.n  a8, 0
    s32i.n  a8, a7, 28
    mov     a10, a7
    call8   stage3e34_sample_and_render
    retw.n
.Lsample_store:
    s32i.n  a8, a7, 28
    retw.n
    .size stage3e34_wpm_ui_refresh, . - stage3e34_wpm_ui_refresh

    .balign 4
