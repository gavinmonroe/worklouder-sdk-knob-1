/*
 * Framer F1 0.4.1 host-fed music controller, screen ID 1.
 *
 * OFFLINE CANDIDATE ONLY. This module intentionally has no setup wrapper and
 * The top-level combined wrapper calls stock setup once, then calls
 * music_id1_register and the WPM registration-only entry. This module owns
 * Framer-local mp.write_info registration; RPC callbacks stage only fixed RAM
 * and the controller's UI refresh applies metadata on the LVGL thread.
 *
 * music_id1_register window ABI:
 *   a2 = stock screen registry returned by 0x4210AD9C
 *   a3 = stock navigation manager returned by 0x42006888
 *   a2 return = allocated controller, or zero on allocation failure
 *
 * The first proof renders a deterministic mock track. The RGB565 album art is
 * generated directly into controller-owned RAM; no music asset is appended to
 * DROM. The soft radial field is painted from nested rounded LVGL children.
 */

    .section .literal.music_id1, "a", @progbits
    .balign 4
.Loperator_new:                .long 0x420e7c04
.Lmemset:                      .long 0x400011e8
.Lbase_vtable:                 .long 0x3c1acc34
.Ladd_controller:              .long 0x4204da84
.Ladd_navigation_id:           .long 0x420293a8

/* Eleven-word controller vtable copied into controller +160. */
.Lvtable_slot_0:                .long 0x4204d5dc
.Lvtable_slot_1:                .long music_id1_build
.Lvtable_slot_2:                .long 0x4204d694
.Lvtable_slot_3:                .long 0x4210882c
.Lvtable_slot_4:                .long music_id1_cleanup
.Lvtable_slot_5:                .long 0x4204d6d0
.Lvtable_slot_6:                .long music_id1_ui_refresh
.Lvtable_slot_7:                .long 0x42108834
.Lvtable_slot_8:                .long music_id1_id
.Lvtable_slot_9:                .long music_id1_encoder
.Lvtable_slot_10:               .long 0x42108844

/* Reviewed stock LVGL helpers. */
.Limage_create:                 .long 0x420ae8a0
.Limage_set_src:                .long 0x420aeef0
.Llabel_create:                 .long 0x4204f170
.Llabel_set_font:               .long 0x4204f018
.Llabel_set_text:               .long 0x4204ee30
.Llabel_set_color:              .long 0x4204ef44
.Lobject_set_size:              .long 0x4209d154
.Lobject_align:                 .long 0x4204f0d0
.Lstyle_bg_color:               .long 0x4204ef10
.Lstyle_bg_opacity:             .long 0x4204efd0
.Lstyle_radius:                 .long 0x420a0f38
.Lsmall_font_ascii:             .long 0x3c18e960

/* RGB colors use stock wrapper format 0xRRGGBB. */
.Ledge_color:                   .long 0x040814
.Lglow_0:                       .long 0x061126
.Lglow_1:                       .long 0x0a1c3b
.Lglow_2:                       .long 0x102d59
.Lglow_3:                       .long 0x174273
.Lglow_4:                       .long 0x1e5a94
.Lglow_5:                       .long 0x276fb5
.Lglow_6:                       .long 0x2e86de
.Ltrack_color:                  .long 0x273148
.Lprogress_color:               .long 0xebf7ff
.Ltitle_color:                  .long 0xf8faff
.Lartist_color:                 .long 0xaebedc

/* Mock RGB565 pixels and native descriptor words. */
.Lpixel_dark:                   .long 0x00000084
.Lpixel_blue:                   .long 0x00002c3b
.Lpixel_cyan:                   .long 0x0000673f
.Ldescriptor_word_0:            .long 0x00001219 /* magic=0x19, cf=RGB565=0x12 */
.Ldescriptor_word_1:            .long 0x00400040 /* width=64, height=64 */
.Ldescriptor_word_2:            .long 0x00000080 /* stride=128, reserved=0 */
.Ldescriptor_data_size:         .long 8192
.Lcontroller_bytes:             .long 8424
.Lcircle_radius:                .long 32767

/* Text words are copied to stack so LVGL never dereferences appended IROM. */
.Ltitle_0:                      .long 0x4e44494d /* "MIDN" */
.Ltitle_1:                      .long 0x54484749 /* "IGHT" */
.Ltitle_2:                      .long 0x52494320 /* " CIR" */
.Ltitle_3:                      .long 0x54495543 /* "CUIT" */
.Ltitle_4:                      .long 0x00000000
.Lartist_0:                     .long 0x54415453 /* "STAT" */
.Lartist_1:                     .long 0x42204349 /* "IC B" */
.Lartist_2:                     .long 0x4d4f4f4c /* "LOOM" */
.Lartist_3:                     .long 0x00000000
.Ltime_0:                       .long 0x32343a31 /* "1:42" */
.Ltime_1:                       .long 0x34202f20 /* " / 4" */
.Ltime_2:                       .long 0x0030303a /* ":00" */

    .section .text.music_id1, "ax", @progbits
    .balign 4

/*
 * Controller allocation remains the live-tested 8424 bytes:
 *   +0..+27    stock common prefix
 *   +28        UI tick (screen-rebuild replay gate)
 *   +32        album descriptor initialized flag
 *   +36        mock progress permille (425)
 *   +40        album image child (borrowed)
 *   +44        title label child (borrowed)
 *   +48        artist label child (borrowed)
 *   +52        time label child (borrowed)
 *   +56        pointer to separate 87980-byte transport state, or zero
 *   +60        background image child (borrowed)
 *   +64..+87   live artwork descriptor 0
 *   +88..+111  live artwork descriptor 1
 *   +112..+135 background descriptor 0
 *   +136..+159 background descriptor 1
 *   +160..+203 eleven-word vtable
 *   +204..+207 reserved/alignment
 *   +208..+231 native lv_image_dsc_t in controller RAM
 *   +232..+8423 64x64 RGB565 album pixels in controller RAM
 *
 * The separate state is allocated once during Music registration so the
 * proven controller allocation, vtable literals, and every WPM byte/address
 * remain frozen. It contains metadata plus bounded control words, two 80x80
 * RGB565 buffers, and one UI-thread-owned 100x310 RGB565 radial buffer. RPC
 * always decodes into the inactive album buffer and LVGL swaps to that
 * buffer's distinct controller descriptor only after a complete generation.
 */

    .global music_id1_register
    .type music_id1_register, @function
music_id1_register:
    entry   a1, 48
    mov     a7, a2                       /* Registry. */
    mov     a6, a3                       /* Navigation manager. */

    l32r    a10, .Lcontroller_bytes
    l32r    a8, .Loperator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lregister_done

    mov     a10, a5
    movi.n  a11, 0
    l32r    a12, .Lcontroller_bytes
    l32r    a8, .Lmemset
    callx8  a8

    l32r    a8, .Lbase_vtable
    s32i.n  a8, a5, 0
    movi.n  a8, 10
    s8i     a8, a5, 26
    movi    a8, 425
    s32i    a8, a5, 36

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

    /* add_controller has no success return. Its reviewed success postcondition
     * is controller+20 == registry; never expose navigation before that. */
    l32i    a8, a5, 20
    bne     a8, a7, .Lregister_failed

    /* Same-size hook: helper admits navigation ID1, allocates bounded transport
     * state, and registers RPC. Keeping this exact window size preserves every
     * following live Music/WPM symbol and vtable pointer address. */
    mov     a10, a5
    mov     a11, a6
    call8   .Lregister_media_rpc_entry
    j       .Lregister_done
    nop

.Lregister_failed:
    movi.n  a5, 0

.Lregister_done:
    mov     a2, a5
    retw.n
    .size music_id1_register, . - music_id1_register

/* Build the native descriptor and the deterministic 8x8-grid album cover. */
    .balign 4
    .type music_id1_init_album, @function
music_id1_init_album:
    entry   a1, 48
    mov     a7, a2
    l32i    a8, a7, 32
    bnez    a8, .Lalbum_init_done

    addi    a6, a7, 208
    l32r    a8, .Ldescriptor_word_0
    s32i    a8, a6, 0
    l32r    a8, .Ldescriptor_word_1
    s32i    a8, a6, 4
    l32r    a8, .Ldescriptor_word_2
    s32i    a8, a6, 8
    l32r    a8, .Ldescriptor_data_size
    s32i    a8, a6, 12
    addi    a5, a7, 232
    s32i    a5, a6, 16
    movi.n  a8, 0
    s32i    a8, a6, 20

    movi.n  a4, 0                       /* y */
.Lalbum_y:
    movi.n  a3, 0                       /* x */
.Lalbum_x:
    srli    a8, a4, 3                   /* 8-pixel source cell y. */
    srli    a9, a3, 3                   /* 8-pixel source cell x. */
    l32r    a2, .Lpixel_blue
    beqz    a8, .Lalbum_dark
    movi.n  a10, 7
    beq     a8, a10, .Lalbum_dark
    beqz    a9, .Lalbum_dark
    beq     a9, a10, .Lalbum_dark
    movi.n  a10, 2
    beq     a8, a10, .Lalbum_cyan_row
    movi.n  a10, 5
    bne     a8, a10, .Lalbum_store
.Lalbum_cyan_row:
    movi.n  a10, 3
    beq     a9, a10, .Lalbum_cyan
    movi.n  a10, 4
    bne     a9, a10, .Lalbum_store
.Lalbum_cyan:
    l32r    a2, .Lpixel_cyan
    j       .Lalbum_store
.Lalbum_dark:
    l32r    a2, .Lpixel_dark
.Lalbum_store:
    slli    a8, a4, 7                   /* y * 128-byte stride. */
    slli    a9, a3, 1                   /* x * two bytes. */
    add     a8, a8, a9
    add     a8, a8, a5
    s16i    a2, a8, 0
    addi    a3, a3, 1
    bltui   a3, 64, .Lalbum_x
    addi    a4, a4, 1
    bltui   a4, 64, .Lalbum_y

    movi.n  a8, 1
    s32i    a8, a7, 32
.Lalbum_init_done:
    retw.n
    .size music_id1_init_album, . - music_id1_init_album

/* a2=parent,a3=width,a4=height,a5=x,a6=y,a7=0xRRGGBB. */
    .balign 4
    .type music_id1_make_panel, @function
music_id1_make_panel:
    entry   a1, 64
    s32i    a3, a1, 16
    s32i    a4, a1, 20
    s32i    a5, a1, 24
    s32i    a6, a1, 28
    s32i    a7, a1, 32
    mov     a10, a2
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a6, a10
    beqz    a6, .Lpanel_done

    movi.n  a8, 0x20                    /* " \0" in stack RAM. */
    s32i    a8, a1, 36
    mov     a10, a6
    addi    a11, a1, 36
    l32r    a8, .Llabel_set_text
    callx8  a8

    mov     a10, a6
    l32i    a11, a1, 16
    l32i    a12, a1, 20
    l32r    a8, .Lobject_set_size
    callx8  a8

    mov     a10, a6
    l32i    a11, a1, 32
    movi.n  a12, 0
    l32r    a8, .Lstyle_bg_color
    callx8  a8

    mov     a10, a6
    movi    a11, 255
    movi.n  a12, 0
    l32r    a8, .Lstyle_bg_opacity
    callx8  a8

    mov     a10, a6
    l32r    a11, .Lcircle_radius        /* LV_RADIUS_CIRCLE. */
    movi.n  a12, 0
    l32r    a8, .Lstyle_radius
    callx8  a8

    mov     a10, a6
    movi.n  a11, 9                      /* CENTER */
    l32i    a12, a1, 24
    l32i    a13, a1, 28
    l32r    a8, .Lobject_align
    callx8  a8
.Lpanel_done:
    mov     a2, a6
    retw.n
    .size music_id1_make_panel, . - music_id1_make_panel

/* a2=parent,a3=y,a4=initial text,a5=color; returns label in a2. */
    .balign 4
    .type music_id1_make_label, @function
music_id1_make_label:
    entry   a1, 48
    mov     a7, a3
    mov     a6, a4
    mov     a5, a5
    mov     a10, a2
    l32r    a8, .Llabel_create
    callx8  a8
    mov     a4, a10
    beqz    a4, .Llabel_done

    mov     a10, a4
    l32r    a11, .Lsmall_font_ascii
    movi.n  a12, 0
    l32r    a8, .Llabel_set_font
    callx8  a8
    mov     a10, a4
    mov     a11, a6
    l32r    a8, .Llabel_set_text
    callx8  a8
    mov     a10, a4
    movi.n  a11, 2                      /* TOP_MID */
    movi.n  a12, 0
    mov     a13, a7
    l32r    a8, .Lobject_align
    callx8  a8
    mov     a10, a4
    mov     a11, a5
    movi.n  a12, 0
    l32r    a8, .Llabel_set_color
    callx8  a8
.Llabel_done:
    mov     a2, a4
    retw.n
    .size music_id1_make_label, . - music_id1_make_label

    .balign 4
    .global music_id1_build
    .type music_id1_build, @function
music_id1_build:
    entry   a1, 128
    mov     a7, a2
    movi.n  a8, 0
    s32i    a8, a7, 28
    s32i    a8, a7, 40
    s32i    a8, a7, 44
    s32i    a8, a7, 48
    s32i    a8, a7, 52
    s32i    a8, a7, 60
    mov     a10, a7
    call8   music_id1_init_album

    /* Paint the edge first and then nested rounded radial/elliptical bands. */
    l32i.n  a6, a7, 12
    mov     a10, a6
    l32r    a11, .Ledge_color
    movi.n  a12, 0
    l32r    a8, .Lstyle_bg_color
    callx8  a8
    mov     a10, a6
    movi    a11, 255
    movi.n  a12, 0
    l32r    a8, .Lstyle_bg_opacity
    callx8  a8

    /* The first child is one controller-owned full-screen RGB565 image. Its
     * pixels are generated only on the LVGL thread; no label masquerades as a
     * background object and the exact outer rows/columns remain black. */
    mov     a10, a7
    call8   music_id1_build_background

.Lbuild_album:
    /* Album descriptor and pixels are both controller-owned RAM. */
    mov     a10, a6
    l32r    a8, .Limage_create
    callx8  a8
    s32i    a10, a7, 40
    beqz    a10, .Lbuild_title
    addi    a11, a7, 208
    l32r    a8, .Limage_set_src
    callx8  a8
    l32i    a10, a7, 40
    movi.n  a11, 9
    movi.n  a12, 0
    movi.n  a13, 0
    l32r    a8, .Lobject_align
    callx8  a8

.Lbuild_title:
    l32r    a8, .Ltitle_0
    s32i    a8, a1, 16
    l32r    a8, .Ltitle_1
    s32i    a8, a1, 20
    l32r    a8, .Ltitle_2
    s32i    a8, a1, 24
    l32r    a8, .Ltitle_3
    s32i    a8, a1, 28
    l32r    a8, .Ltitle_4
    s32i    a8, a1, 32
    mov     a10, a6
    movi    a11, 82
    addi    a12, a1, 16
    l32r    a13, .Ltitle_color
    call8   music_id1_make_label
    s32i    a10, a7, 44

    l32r    a8, .Lartist_0
    s32i    a8, a1, 40
    l32r    a8, .Lartist_1
    s32i    a8, a1, 44
    l32r    a8, .Lartist_2
    s32i    a8, a1, 48
    l32r    a8, .Lartist_3
    s32i    a8, a1, 52
    mov     a10, a6
    movi    a11, 204
    addi    a12, a1, 40
    l32r    a13, .Lartist_color
    call8   music_id1_make_label
    s32i    a10, a7, 48

.Lbuild_time:
    l32r    a8, .Ltime_0
    s32i    a8, a1, 64
    l32r    a8, .Ltime_1
    s32i    a8, a1, 68
    l32r    a8, .Ltime_2
    s32i    a8, a1, 72
    mov     a10, a6
    movi    a11, 236
    addi    a12, a1, 64
    l32r    a13, .Lartist_color
    call8   music_id1_make_label
    s32i    a10, a7, 52
    retw.n
    .size music_id1_build, . - music_id1_build

/* Root teardown owns LVGL children; descriptor/pixels belong to controller. */
    .balign 4
    .global music_id1_cleanup
    .type music_id1_cleanup, @function
music_id1_cleanup:
    entry   a1, 32
    movi.n  a8, 0
    s32i    a8, a2, 40
    s32i    a8, a2, 44
    s32i    a8, a2, 48
    s32i    a8, a2, 52
    s32i    a8, a2, 60                 /* borrowed root child; never free here */
    retw.n
    .size music_id1_cleanup, . - music_id1_cleanup

    .balign 4
    .global music_id1_ui_refresh
    .type music_id1_ui_refresh, @function
music_id1_ui_refresh:
    entry   a1, 48
    mov     a10, a2
    call8   .Lui_refresh_transport_entry
    nop.n
    nop.n
    retw.n
    .size music_id1_ui_refresh, . - music_id1_ui_refresh

    .balign 4
    .global music_id1_id
    .type music_id1_id, @function
music_id1_id:
    entry   a1, 32
    movi.n  a2, 1
    retw.n
    .size music_id1_id, . - music_id1_id

/* No global input hook. Future controls must remain in this screen's slot 9. */
    .balign 4
    .global music_id1_encoder
    .type music_id1_encoder, @function
music_id1_encoder:
    entry   a1, 32
    retw.n
    .size music_id1_encoder, . - music_id1_encoder

/* -------------------------------------------------------------------------
 * Music-only host transport. These literals intentionally live after the
 * frozen WPM-leading portion of the combined link. Expanding Music code may
 * never move or rewrite the byte-pinned WPM registration module.
 */
    .balign 4
.Lrpc_registry_fn:              .long 0x42004afc
.Lrpc_register_fn:              .long 0x420540f4
.Lrpc_callback_destroy_fn:      .long 0x42106ae4
.Lrpc_callback_closure:         .long 0x4200465c
.Lrequest_root_ctor_fn:         .long 0x420576a4
.Ljson_proxy_ctor_fn:           .long 0x420052e4
.Ljson_variant_fn:              .long 0x42005590
.Ljson_string_fn:               .long 0x420055c0
.Ljson_string_tuple_fn:         .long 0x420046e0
.Ljson_proxy_dtor_fn:           .long 0x42004f80
.Ljson_lookup_fn:               .long 0x42005560
.Ljson_integer_fn:              .long 0x42059638
.Ljson_response_key_fn:         .long 0x42005240
.Ljson_assign_string_fn:        .long 0x42005a18
.Lrpc_respond_fn:               .long 0x42057d40
.Lbase64_decode_fn:             .long 0x420cd968
.Lstrlen_fn:                    .long 0x40001248
.Ljson_allocator_state:         .long 0x3fca4f34
.Ltransport_state_bytes:        .long 87980
.Lstring_table_offset:          .long 25808
.Lartwork_bytes:                .long 12800
.Lchunk_raw_bytes:              .long 3072
.Lartwork_buffer_1_offset:      .long 13008
.Lart_descriptor_word_1:       .long 0x00500050 /* width=80,height=80 */
.Lart_descriptor_word_2:       .long 0x000000a0 /* stride=160 */
.Laccent_value_offset:          .long 25960
.Lbackground_active_offset:     .long 25972
.Lbackground_applied_offset:    .long 25976
.Lbackground_buffer_offset:     .long 25980
.Lbackground_bytes:             .long 62000
.Lbackground_descriptor_word_1: .long 0x01360064 /* width=100,height=310 */
.Lbackground_descriptor_word_2: .long 0x000000c8 /* stride=200 */
.Lprogress_buffer_offset:       .long 80400 /* pixels y=272,x=10 from state */
.Lalbum_background_offset:      .long 49000 /* pixels y=115,x=10 from state */
.Lprogress_track_pixel:         .long 0x00001082
.Lradial_one_q16:               .long 65025 /* 255 squared */
.Lradial_round_q16:             .long 32768
.Linfo_callback_ptr:            .long music_id1_info_callback
.Lart_callback_ptr:             .long music_id1_art_callback
/* Ordinary data reads from appended IROM fault on Framer. These are l32r-only
 * word literals; every stock C/JSON helper receives a reconstructed stack-RAM
 * string. Never replace them with an ordinary string directive or pass one of these labels. */
.Lstr_mp_write_0:               .long 0x772e706d /* "mp.w" */
.Lstr_mp_write_1:               .long 0x65746972 /* "rite" */
.Lstr_info_2:                   .long 0x666e695f /* "_inf" */
.Lstr_info_3:                   .long 0x0000006f /* "o\0" */
.Lstr_art_2:                    .long 0x7472615f /* "_art" */
.Lstr_art_3:                    .long 0x6b726f77 /* "work" */
.Lstr_art_4:                    .long 0x00000000
.Lstr_song_title_0:             .long 0x676e6f73
.Lstr_song_title_1:             .long 0x7469745f
.Lstr_song_title_2:             .long 0x0000656c
.Lstr_artist_0:                 .long 0x69747261
.Lstr_artist_1:                 .long 0x00007473
.Lstr_elapsed_0:                .long 0x70616c65
.Lstr_elapsed_1:                .long 0x00646573
.Lstr_duration_0:               .long 0x61746f74
.Lstr_duration_1:               .long 0x75645f6c
.Lstr_duration_2:               .long 0x69746172
.Lstr_duration_3:               .long 0x00006e6f
.Lstr_playing_0:                .long 0x705f7369
.Lstr_playing_1:                .long 0x6979616c
.Lstr_playing_2:                .long 0x0000676e
.Lstr_accent_0:                 .long 0x65636361 /* "acce" */
.Lstr_accent_1:                 .long 0x635f746e /* "nt_c" */
.Lstr_accent_2:                 .long 0x726f6c6f /* "olor" */
.Lstr_accent_3:                 .long 0x00000000
.Lstr_data_0:                   .long 0x61746164
.Lstr_data_1:                   .long 0x00000000
.Lstr_offset_0:                 .long 0x7366666f
.Lstr_offset_1:                 .long 0x00007465
.Lstr_size_0:                   .long 0x657a6973
.Lstr_size_1:                   .long 0x00000000
.Lstr_status_0:                 .long 0x74617473
.Lstr_status_1:                 .long 0x00007375
.Lstr_ok_0:                     .long 0x00006b6f
.Lstr_error_0:                  .long 0x6f727265
.Lstr_error_1:                  .long 0x00000072
/* Bounded live diagnostic statuses occupy reserved transport state +148..183. */
.Ldiag_e1:                      .long 0x00003165
.Ldiag_e2:                      .long 0x00003265
.Ldiag_e3:                      .long 0x00003365
.Ldiag_e4:                      .long 0x00003465
.Ldiag_e5:                      .long 0x00003565
.Ldiag_e6:                      .long 0x00003665
.Ldiag_e7:                      .long 0x00003765
.Ldiag_e8:                      .long 0x00003865
.Ldiag_e9:                      .long 0x00003965
    .balign 4

/* Build one temporary stock callback object and register mp.write_info.
 * a2=controller. The stock registry copies the callback before its temporary
 * destructor runs, exactly as v.framer.bubble does in firmware 0.4.1. */
    .global music_id1_register_media_rpc
    .type music_id1_register_media_rpc, @function
.Lregister_media_rpc_entry:
music_id1_register_media_rpc:
    entry   a1, 64
    mov     a7, a2
    mov     a6, a3

    /* Navigation remains independently admitted after the controller+20
     * registry postcondition; ID8 is never touched. */
    mov     a10, a6
    movi.n  a11, 1
    l32r    a8, .Ladd_navigation_id
    callx8  a8

    /* Transport state is controller-lifetime RAM and is intentionally not an
     * LVGL child. Screen teardown therefore never frees or traverses it. */
    l32i    a5, a7, 56
    bnez    a5, .Lrpc_have_state
    l32r    a10, .Ltransport_state_bytes
    l32r    a8, .Loperator_new
    callx8  a8
    mov     a5, a10
    beqz    a5, .Lrpc_register_done
    mov     a10, a5
    movi.n  a11, 0
    l32r    a12, .Ltransport_state_bytes
    l32r    a8, .Lmemset
    callx8  a8
    mov     a10, a5
    call8   .Linit_rpc_strings_entry
    s32i    a5, a7, 56
.Lrpc_have_state:
    l32r    a8, .Lrpc_registry_fn
    callx8  a8
    mov     a6, a10
    beqz    a6, .Lrpc_register_done

    movi.n  a8, 0
    s32i    a7, a1, 16                  /* callback +0: controller context */
    s32i    a8, a1, 20                  /* callback +4: reserved */
    l32r    a8, .Lrpc_callback_closure
    s32i    a8, a1, 24                  /* callback +8: stock closure ABI */
    movi.n  a8, 0
    s32i    a8, a1, 28
    movi.n  a8, 13
    s32i    a8, a1, 32
    l32r    a8, .Lstring_table_offset
    add     a8, a5, a8                 /* persistent RAM mp.write_info */
    s32i    a8, a1, 36
    mov     a10, a6
    l32i    a11, a1, 32
    l32i    a12, a1, 36
    addi    a13, a1, 16
    l32r    a8, .Linfo_callback_ptr
    s32i    a8, a1, 28                  /* callback +12: dispatch thunk */
    l32r    a8, .Lrpc_register_fn
    callx8  a8
    addi    a10, a1, 16
    l32r    a8, .Lrpc_callback_destroy_fn
    callx8  a8

    /* Register artwork independently with the same stock callback ABI. */
    movi.n  a8, 0
    s32i    a7, a1, 16
    s32i    a8, a1, 20
    l32r    a8, .Lrpc_callback_closure
    s32i    a8, a1, 24
    l32r    a8, .Lart_callback_ptr
    s32i    a8, a1, 28
    movi.n  a8, 16
    s32i    a8, a1, 32
    l32r    a8, .Lstring_table_offset
    add     a8, a5, a8
    addi    a8, a8, 16                 /* persistent RAM mp.write_artwork */
    s32i    a8, a1, 36
    mov     a10, a6
    l32i    a11, a1, 32
    l32i    a12, a1, 36
    addi    a13, a1, 16
    l32r    a8, .Lrpc_register_fn
    callx8  a8
    addi    a10, a1, 16
    l32r    a8, .Lrpc_callback_destroy_fn
    callx8  a8
.Lrpc_register_done:
    retw.n
    .size music_id1_register_media_rpc, . - music_id1_register_media_rpc

/* a2=zeroed transport state. Build the controller-lifetime string table at
 * [state+25808,state+25960) exclusively through l32r word literals. */
    .balign 4
    .type music_id1_init_rpc_strings, @function
.Linit_rpc_strings_entry:
music_id1_init_rpc_strings:
    entry   a1, 32
    l32r    a8, .Lstring_table_offset
    add     a7, a2, a8
    l32r    a8, .Lstr_mp_write_0
    s32i    a8, a7, 0
    l32r    a8, .Lstr_mp_write_1
    s32i    a8, a7, 4
    l32r    a8, .Lstr_info_2
    s32i    a8, a7, 8
    l32r    a8, .Lstr_info_3
    s32i    a8, a7, 12
    l32r    a8, .Lstr_mp_write_0
    s32i    a8, a7, 16
    l32r    a8, .Lstr_mp_write_1
    s32i    a8, a7, 20
    l32r    a8, .Lstr_art_2
    s32i    a8, a7, 24
    l32r    a8, .Lstr_art_3
    s32i    a8, a7, 28
    l32r    a8, .Lstr_art_4
    s32i    a8, a7, 32
    l32r    a8, .Lstr_song_title_0
    s32i    a8, a7, 36
    l32r    a8, .Lstr_song_title_1
    s32i    a8, a7, 40
    l32r    a8, .Lstr_song_title_2
    s32i    a8, a7, 44
    l32r    a8, .Lstr_artist_0
    s32i    a8, a7, 48
    l32r    a8, .Lstr_artist_1
    s32i    a8, a7, 52
    l32r    a8, .Lstr_elapsed_0
    s32i    a8, a7, 56
    l32r    a8, .Lstr_elapsed_1
    s32i    a8, a7, 60
    l32r    a8, .Lstr_duration_0
    s32i    a8, a7, 64
    l32r    a8, .Lstr_duration_1
    s32i    a8, a7, 68
    l32r    a8, .Lstr_duration_2
    s32i    a8, a7, 72
    l32r    a8, .Lstr_duration_3
    s32i    a8, a7, 76
    l32r    a8, .Lstr_playing_0
    s32i    a8, a7, 80
    l32r    a8, .Lstr_playing_1
    s32i    a8, a7, 84
    l32r    a8, .Lstr_playing_2
    s32i    a8, a7, 88
    l32r    a8, .Lstr_data_0
    s32i    a8, a7, 92
    l32r    a8, .Lstr_data_1
    s32i    a8, a7, 96
    l32r    a8, .Lstr_offset_0
    s32i    a8, a7, 100
    l32r    a8, .Lstr_offset_1
    s32i    a8, a7, 104
    l32r    a8, .Lstr_size_0
    s32i    a8, a7, 108
    l32r    a8, .Lstr_size_1
    s32i    a8, a7, 112
    l32r    a8, .Lstr_status_0
    s32i    a8, a7, 116
    l32r    a8, .Lstr_status_1
    s32i    a8, a7, 120
    l32r    a8, .Lstr_ok_0
    s32i    a8, a7, 124
    l32r    a8, .Lstr_error_0
    s32i    a8, a7, 128
    l32r    a8, .Lstr_error_1
    s32i    a8, a7, 132
    l32r    a8, .Lstr_accent_0
    s32i    a8, a7, 136
    l32r    a8, .Lstr_accent_1
    s32i    a8, a7, 140
    l32r    a8, .Lstr_accent_2
    s32i    a8, a7, 144
    l32r    a8, .Lstr_accent_3
    s32i    a8, a7, 148
    l32r    a8, .Ldiag_e1
    s32i    a8, a2, 148
    l32r    a8, .Ldiag_e2
    s32i    a8, a2, 152
    l32r    a8, .Ldiag_e3
    s32i    a8, a2, 156
    l32r    a8, .Ldiag_e4
    s32i    a8, a2, 160
    l32r    a8, .Ldiag_e5
    s32i    a8, a2, 164
    l32r    a8, .Ldiag_e6
    s32i    a8, a2, 168
    l32r    a8, .Ldiag_e7
    s32i    a8, a2, 172
    l32r    a8, .Ldiag_e8
    s32i    a8, a2, 176
    l32r    a8, .Ldiag_e9
    s32i    a8, a2, 180
    memw
    retw.n
    .size music_id1_init_rpc_strings, . - music_id1_init_rpc_strings

/* Stock dispatch thunk ABI: a2 points at copied callback, a3 points at the
 * response context holder, and a4 is the request payload object. */
    .balign 4
    .global music_id1_info_callback
    .type music_id1_info_callback, @function
music_id1_info_callback:
    entry   a1, 32
    mov     a12, a4
    l32i.n  a11, a3, 0
    l32i.n  a10, a2, 0
    call8   .Lhandle_info_entry
    retw.n
    .size music_id1_info_callback, . - music_id1_info_callback

    .balign 4
    .global music_id1_art_callback
    .type music_id1_art_callback, @function
music_id1_art_callback:
    entry   a1, 32
    mov     a12, a4
    l32i.n  a11, a3, 0
    l32i.n  a10, a2, 0
    call8   .Lhandle_art_entry
    retw.n
    .size music_id1_art_callback, . - music_id1_art_callback

/* a2=root,a3=key,a4=key bytes,a5=destination,a6=capacity; returns a2=1 if
 * present. Direct lookup returns a JsonVariant node, not a character pointer.
 * Stock 0x420046e0 converts that node to the exact (pointer,length,flag) tuple
 * used by 0x420055c0. Copy the returned bounded length and destroy only the
 * request root; no temporary proxy lifetime is introduced. */
    .balign 4
    .type music_id1_read_string, @function
music_id1_read_string:
    entry   a1, 64
    s32i    a5, a1, 16                /* destination */
    s32i    a6, a1, 20                /* capacity */
    mov     a7, a2                    /* request root */
    addi    a10, a7, 56
    mov     a11, a3
    mov     a12, a4
    movi.n  a13, 1
    mov     a14, a7
    l32r    a8, .Ljson_lookup_fn
    callx8  a8
    beqz    a10, .Lread_string_failure
    l32r    a8, .Ljson_string_tuple_fn
    callx8  a8
    mov     a5, a10
    mov     a4, a11                   /* exact tuple length */
    beqz    a5, .Lread_string_failure
    l32i    a7, a1, 16
    l32i    a6, a1, 20
    addi    a6, a6, -1
    min     a6, a6, a4
    movi.n  a3, 0
.Lread_string_copy:
    bgeu    a3, a6, .Lread_string_terminate
    l8ui    a8, a5, 0
    s8i     a8, a7, 0
    addi    a5, a5, 1
    addi    a7, a7, 1
    addi    a3, a3, 1
    j       .Lread_string_copy
.Lread_string_terminate:
    movi.n  a8, 0
    s8i     a8, a7, 0
    movi.n  a2, 1
    retw.n
.Lread_string_failure:
    movi.n  a2, 0
    retw.n
    .size music_id1_read_string, . - music_id1_read_string

/* a2=root,a3=key,a4=key bytes; returns a2=value,a3=present. The numeric
 * converter is byte-identical in control flow to Nomad's media helper and
 * accepts JSON integer/float/bool variants. */
    .balign 4
    .type music_id1_read_integer, @function
music_id1_read_integer:
    entry   a1, 48
    mov     a7, a2
    addi    a10, a7, 56
    mov     a11, a3
    mov     a12, a4
    movi.n  a13, 1
    mov     a14, a7
    l32r    a8, .Ljson_lookup_fn
    callx8  a8
    beqz    a10, .Lread_integer_missing
    mov     a11, a7
    l32r    a8, .Ljson_integer_fn
    callx8  a8
    mov     a2, a10
    movi.n  a3, 1
    retw.n
.Lread_integer_missing:
    movi.n  a2, 0
    movi.n  a3, 0
    retw.n
    .size music_id1_read_integer, . - music_id1_read_integer

/* Reply with Framer's stock-proven {status:<a4>} object. a4=0 selects ok,
 * a4=-1 selects generic error, and a4=1..9 selects bounded diagnostics e1..e9.
 * a5 is the fixed RAM string table. */
    .balign 4
    .type music_id1_reply_status, @function
.Lreply_status_entry:
music_id1_reply_status:
    entry   a1, 112
    mov     a7, a2                       /* response context */
    mov     a6, a3                       /* request */
    beqz    a4, .Lreply_build_ok
    movi.n  a8, -1
    beq     a4, a8, .Lreply_build_error
    addi    a8, a4, -1
    slli    a8, a8, 2
    l32r    a9, .Lstring_table_offset
    sub     a10, a5, a9
    addi    a5, a10, 148
    add     a5, a5, a8                  /* persistent RAM e1..e9 */
    add     a4, a10, a9
    addi    a4, a4, 116                 /* persistent RAM "status" */
    j       .Lreply_value_ready
.Lreply_build_error:
    addi    a4, a5, 116                 /* persistent RAM "status" */
    addi    a5, a5, 124                 /* persistent RAM "error" */
    j       .Lreply_value_ready
.Lreply_build_ok:
    addi    a4, a5, 116                 /* persistent RAM "status" */
    addi    a5, a5, 124                 /* persistent RAM "ok" */
.Lreply_value_ready:
    l32r    a8, .Ljson_allocator_state
    s32i    a8, a1, 16
    movi.n  a9, 0
    s8i     a9, a1, 20
    s32i    a9, a1, 24
    addi    a8, a1, 28
    s32i    a8, a1, 60
    s16i    a9, a1, 64
    movi.n  a8, 4
    s16i    a8, a1, 66
    movi.n  a8, -1
    s16i    a8, a1, 68
    s8i     a9, a1, 76
    s16i    a8, a1, 78
    mov     a10, a1
    addi    a11, a1, 16
    mov     a12, a4
    l32r    a8, .Ljson_response_key_fn
    callx8  a8
    mov     a10, a1
    mov     a11, a5
    movi.n  a12, 0
    l32r    a8, .Ljson_assign_string_fn
    callx8  a8
    mov     a10, a7
    mov     a11, a6
    addi    a12, a1, 16
    l32r    a8, .Lrpc_respond_fn
    callx8  a8
    addi    a10, a1, 16
    l32r    a8, .Ljson_proxy_dtor_fn
    callx8  a8
    retw.n
    .size music_id1_reply_status, . - music_id1_reply_status

/* a2=controller,a3=response context,a4=request. All RPC task writes stay in
 * fixed controller RAM. Generation is a seqlock: odd means the producer is
 * mutating metadata; the following even value publishes one stable snapshot. */
    .balign 4
    .global music_id1_handle_info
    .type music_id1_handle_info, @function
.Lhandle_info_entry:
music_id1_handle_info:
    entry   a1, 320
    l32i    a7, a2, 56                  /* separate fixed transport state */
    mov     a6, a3
    mov     a5, a4
    beqz    a7, .Linfo_return
    l32r    a8, .Lstring_table_offset
    add     a4, a7, a8                  /* fixed controller-lifetime strings */
    l32r    a8, .Lrpc_registry_fn
    callx8  a8
    mov     a11, a10
    addi    a10, a1, 224                /* stock-aligned 64-byte request root */
    mov     a12, a5
    l32r    a8, .Lrequest_root_ctor_fn
    callx8  a8

    /* Publish an odd generation before touching any shared metadata byte. */
    l32i    a8, a7, 140
    movi.n  a9, 1
    or      a8, a8, a9
    s32i    a8, a7, 140
    memw

    addi    a10, a1, 224
    addi    a11, a4, 36                 /* RAM "song_title" */
    movi.n  a12, 10
    mov     a13, a7                     /* state+0 title */
    movi.n  a14, 64
    call8   music_id1_read_string
    s32i    a10, a1, 112                /* diagnostic: title present */

    addi    a10, a1, 224
    addi    a11, a4, 48                 /* RAM "artist" */
    movi.n  a12, 6
    addi    a13, a7, 64                 /* state+64 artist */
    movi.n  a14, 64
    call8   music_id1_read_string
    s32i    a10, a1, 116                /* diagnostic: artist present */

    addi    a10, a1, 224
    addi    a11, a4, 136                /* RAM "accent_color" */
    movi.n  a12, 12
    l32r    a8, .Laccent_value_offset
    add     a13, a7, a8                 /* exact bounded #RRGGBB + NUL */
    movi.n  a14, 8
    call8   music_id1_read_string
    s32i    a10, a1, 120                /* diagnostic: accent present */

    addi    a10, a1, 224
    addi    a11, a4, 56                 /* RAM "elapsed" */
    movi.n  a12, 7
    call8   music_id1_read_integer
    beqz    a11, .Linfo_duration
    movi.n  a8, 0
    max     a10, a10, a8
    movi    a8, 1500
    slli    a8, a8, 2
    addi    a8, a8, -1                 /* 5999 without a new literal */
    min     a10, a10, a8
    s32i    a10, a7, 128
.Linfo_duration:
    addi    a10, a1, 224
    addi    a11, a4, 64                 /* RAM "total_duration" */
    movi.n  a12, 14
    call8   music_id1_read_integer
    s32i    a11, a1, 124                /* full snapshot diagnostic gate */
    beqz    a11, .Linfo_playing
    movi.n  a8, 0
    max     a10, a10, a8
    movi    a8, 1500
    slli    a8, a8, 2
    addi    a8, a8, -1                 /* 5999 without a new literal */
    min     a10, a10, a8
    s32i    a10, a7, 132
.Linfo_playing:
    addi    a10, a1, 224
    addi    a11, a4, 80                 /* RAM "is_playing" */
    movi.n  a12, 10
    call8   music_id1_read_integer
    beqz    a11, .Linfo_publish
    beqz    a10, .Linfo_store_stopped
    movi.n  a10, 1
.Linfo_store_stopped:
    s32i    a10, a7, 136
.Linfo_publish:
    memw
    l32i    a8, a7, 140
    addi    a8, a8, 1
    s32i    a8, a7, 140
    memw
.Linfo_reply:
    mov     a10, a6
    mov     a11, a5
    movi.n  a12, 0                      /* RAM-built "ok" */
    l32i    a8, a1, 124                 /* only diagnose full duration snapshots */
    beqz    a8, .Linfo_reply_call
    l32i    a8, a1, 112
    bnez    a8, .Linfo_diag_artist
    movi.n  a12, 1                      /* e1: title lookup/tuple failed */
    j       .Linfo_reply_call
.Linfo_diag_artist:
    l32i    a8, a1, 116
    bnez    a8, .Linfo_diag_accent
    movi.n  a12, 2                      /* e2: artist lookup/tuple failed */
    j       .Linfo_reply_call
.Linfo_diag_accent:
    l32i    a8, a1, 120
    bnez    a8, .Linfo_reply_call
    movi.n  a12, 3                      /* e3: accent lookup/tuple failed */
.Linfo_reply_call:
    mov     a13, a4
    call8   .Lreply_status_entry
    addi    a10, a1, 224
    l32r    a8, .Ljson_proxy_dtor_fn
    callx8  a8                         /* one request-root destruction only */
.Linfo_return:
    retw.n
    .size music_id1_handle_info, . - music_id1_handle_info

/* a2=ASCII byte; returns a2=value (0..64), a3=valid. Padding '=' is 64. */
    .balign 4
    .type music_id1_base64_value, @function
.Lb64_value_entry:
music_id1_base64_value:
    entry   a1, 32
    extui   a8, a2, 0, 8
    movi.n  a9, 'A'
    bltu    a8, a9, .Lb64_lower
    movi.n  a10, 'Z' + 1
    bgeu    a8, a10, .Lb64_lower
    addi    a2, a8, -'A'
    movi.n  a3, 1
    retw.n
.Lb64_lower:
    movi.n  a9, 'a'
    bltu    a8, a9, .Lb64_digit
    movi.n  a10, 'z' + 1
    bgeu    a8, a10, .Lb64_digit
    addi    a2, a8, 26 - 'a'
    movi.n  a3, 1
    retw.n
.Lb64_digit:
    movi.n  a9, '0'
    bltu    a8, a9, .Lb64_symbols
    movi.n  a10, '9' + 1
    bgeu    a8, a10, .Lb64_symbols
    addi    a2, a8, 52 - '0'
    movi.n  a3, 1
    retw.n
.Lb64_symbols:
    movi.n  a2, 62
    movi.n  a9, '+'
    beq     a8, a9, .Lb64_valid
    movi.n  a2, 63
    movi.n  a9, '/'
    beq     a8, a9, .Lb64_valid
    movi.n  a2, 64
    movi.n  a9, '='
    beq     a8, a9, .Lb64_valid
    movi.n  a2, 0
    movi.n  a3, 0
    retw.n
.Lb64_valid:
    movi.n  a3, 1
    retw.n
    .size music_id1_base64_value, . - music_id1_base64_value

/* a2=base64 string,a3=destination,a4=remaining capacity.
 * Returns a2=decoded bytes,a3=success. Strict padding and no whitespace. */
    .balign 4
    .type music_id1_decode_base64, @function
.Ldecode_base64_entry:
music_id1_decode_base64:
    entry   a1, 96
    mov     a7, a2
    mov     a6, a3
    mov     a5, a4
    movi.n  a4, 0
.Lb64_group:
    l8ui    a8, a7, 0
    beqz    a8, .Lb64_success
    mov     a10, a8
    call8   .Lb64_value_entry
    beqz    a11, .Lb64_failure
    s32i    a10, a1, 16
    l8ui    a10, a7, 1
    call8   .Lb64_value_entry
    beqz    a11, .Lb64_failure
    s32i    a10, a1, 20
    l8ui    a10, a7, 2
    call8   .Lb64_value_entry
    beqz    a11, .Lb64_failure
    s32i    a10, a1, 24
    l8ui    a10, a7, 3
    call8   .Lb64_value_entry
    beqz    a11, .Lb64_failure
    s32i    a10, a1, 28

    l32i    a8, a1, 16
    l32i    a9, a1, 20
    movi.n  a10, 64
    beq     a8, a10, .Lb64_failure
    beq     a9, a10, .Lb64_failure
    beqz    a5, .Lb64_failure
    slli    a8, a8, 2
    srli    a9, a9, 4
    or      a8, a8, a9
    s8i     a8, a6, 0
    addi    a6, a6, 1
    addi    a5, a5, -1
    addi    a4, a4, 1

    l32i    a8, a1, 24
    movi.n  a10, 64
    bne     a8, a10, .Lb64_second
    l32i    a9, a1, 28
    bne     a9, a10, .Lb64_failure
    l8ui    a9, a7, 4
    bnez    a9, .Lb64_failure
    j       .Lb64_success
.Lb64_second:
    beqz    a5, .Lb64_failure
    l32i    a9, a1, 20
    slli    a9, a9, 4
    srli    a8, a8, 2
    or      a8, a8, a9
    s8i     a8, a6, 0
    addi    a6, a6, 1
    addi    a5, a5, -1
    addi    a4, a4, 1

    l32i    a8, a1, 28
    movi.n  a10, 64
    bne     a8, a10, .Lb64_third
    l8ui    a9, a7, 4
    bnez    a9, .Lb64_failure
    j       .Lb64_success
.Lb64_third:
    beqz    a5, .Lb64_failure
    l32i    a9, a1, 24
    slli    a9, a9, 6
    or      a8, a8, a9
    s8i     a8, a6, 0
    addi    a6, a6, 1
    addi    a5, a5, -1
    addi    a4, a4, 1
    addi    a7, a7, 4
    j       .Lb64_group
.Lb64_success:
    mov     a2, a4
    movi.n  a3, 1
    retw.n
.Lb64_failure:
    movi.n  a2, 0
    movi.n  a3, 0
    retw.n
    .size music_id1_decode_base64, . - music_id1_decode_base64

/* a2=controller,a3=response context,a4=request. A transaction must be exactly
 * 80x80 RGB565 (12800 bytes), strictly ordered, and never writes the active
 * buffer. The final chunk alone increments artwork producer generation. */
    .balign 4
    .global music_id1_handle_art
    .type music_id1_handle_art, @function
.Lhandle_art_entry:
music_id1_handle_art:
    entry   a1, 320
    l32i    a7, a2, 56
    mov     a6, a3
    mov     a5, a4
    beqz    a7, .Lart_return
    l32r    a8, .Lstring_table_offset
    add     a4, a7, a8                  /* fixed controller-lifetime strings */
    l32r    a8, .Lrpc_registry_fn
    callx8  a8
    mov     a11, a10
    addi    a10, a1, 224
    mov     a12, a5
    l32r    a8, .Lrequest_root_ctor_fn
    callx8  a8

    addi    a10, a1, 224
    addi    a11, a4, 100                /* RAM "offset" */
    movi.n  a12, 6
    call8   music_id1_read_integer
    beqz    a11, .Lart_error_offset
    s32i    a10, a1, 80
    addi    a10, a1, 224
    addi    a11, a4, 108                /* RAM "size" */
    movi.n  a12, 4
    call8   music_id1_read_integer
    beqz    a11, .Lart_error_size
    s32i    a10, a1, 84
    l32r    a8, .Lartwork_bytes
    bne     a10, a8, .Lart_error_size_value

    l32i    a9, a1, 80                 /* offset */
    bnez    a9, .Lart_continue
    l32i    a8, a7, 200                /* one pending complete image max */
    l32i    a10, a7, 204
    bne     a8, a10, .Lart_error_pending
    l32i    a8, a7, 184                /* active index */
    movi.n  a10, 1
    xor     a8, a8, a10
    s32i    a8, a7, 188                /* inactive staging index */
    l32i    a8, a1, 84
    s32i    a8, a7, 196
    memw                                /* publish transaction initialization */
.Lart_continue:
    memw                                /* acquire staged transaction size */
    l32i    a8, a7, 196
    l32i    a10, a1, 84
    bne     a8, a10, .Lart_error_transaction_size
    bgeu    a9, a10, .Lart_error_order
    beqz    a9, .Lart_offset_allowed
    l32r    a8, .Lchunk_raw_bytes
    beq     a9, a8, .Lart_offset_allowed /* 3072 */
    slli    a10, a8, 1
    beq     a9, a10, .Lart_offset_allowed /* 6144 */
    add     a10, a10, a8
    beq     a9, a10, .Lart_offset_allowed /* 9216 */
    slli    a10, a8, 2
    bne     a9, a10, .Lart_error_order   /* final offset 12288 */
.Lart_offset_allowed:

    /* Nomad's stock mp.write_artwork handler resolves data directly from the
     * request root rather than through the metadata proxy/string converter. */
    addi    a10, a1, 224               /* request root */
    addi    a10, a10, 56               /* root-owned lookup state */
    addi    a11, a4, 92                /* RAM "data" */
    movi.n  a12, 4                     /* key bytes */
    movi.n  a13, 1                     /* required lookup */
    addi    a14, a1, 224               /* request root owner */
    l32r    a8, .Ljson_lookup_fn
    callx8  a8
    beqz    a10, .Lart_error_data_lookup
    l32r    a8, .Ljson_string_tuple_fn  /* node -> exact pointer,length,flag */
    callx8  a8
    beqz    a10, .Lart_error_data_string
    s32i    a10, a1, 88                /* request-owned base64 pointer */
    s32i    a11, a1, 92                /* exact bounded wire string length */
    l32i    a8, a7, 188
    addi    a3, a7, 208                /* buffer 0 */
    beqz    a8, .Lart_have_buffer
    l32r    a8, .Lartwork_buffer_1_offset
    add     a3, a7, a8                 /* buffer 1 */
.Lart_have_buffer:
    l32i    a9, a1, 80
    add     a3, a3, a9
    l32r    a8, .Lartwork_bytes
    sub     a11, a8, a9                /* decoder capacity */
    l32r    a8, .Lchunk_raw_bytes
    min     a11, a11, a8               /* official Input raw chunk ceiling */
    movi.n  a8, 0
    s32i    a8, a1, 96                 /* stock decoder writes output bytes */
    mov     a10, a3                    /* destination */
    addi    a12, a1, 96                /* decoded-length result */
    l32i    a13, a1, 88                /* base64 input */
    l32i    a14, a1, 92                /* input characters */
    l32r    a8, .Lbase64_decode_fn
    callx8  a8
    bnez    a10, .Lart_error_decode
    l32i    a10, a1, 96                /* decoder-reported output bytes */
    l32i    a9, a1, 80                 /* wire offset */
    l32r    a8, .Lartwork_bytes
    sub     a11, a8, a9
    l32r    a8, .Lchunk_raw_bytes
    min     a11, a11, a8               /* exact protocol bytes for this chunk */
    bne     a10, a11, .Lart_error_decoded_length
    add     a9, a9, a11                /* advance by protocol, not decoder drift */
    memw                                /* publish decoded bytes before success ack */
    l32r    a8, .Lartwork_bytes         /* completion compares against total */
    bne     a9, a8, .Lart_reply_ok_proxy
    memw
    l32i    a8, a7, 200
    addi    a8, a8, 1
    s32i    a8, a7, 200
    memw                                /* publish final generation after pixels */
.Lart_reply_ok_proxy:
    mov     a10, a6
    mov     a11, a5
    movi.n  a12, 0                      /* RAM-built "ok" */
    mov     a13, a4
    call8   .Lreply_status_entry
    addi    a10, a1, 224
    l32r    a8, .Ljson_proxy_dtor_fn
    callx8  a8                         /* one request-root destruction only */
.Lart_return:
    retw.n
.Lart_error_offset:
    movi.n  a12, 1                     /* e1: offset key missing/not numeric */
    j       .Lart_reply_error_common
.Lart_error_size:
    movi.n  a12, 2                     /* e2: size key missing/not numeric */
    j       .Lart_reply_error_common
.Lart_error_size_value:
    movi.n  a12, 3                     /* e3: total size is not 12800 */
    j       .Lart_reply_error_common
.Lart_error_pending:
    movi.n  a12, 4                     /* e4: prior complete image is pending UI */
    j       .Lart_reply_error_common
.Lart_error_transaction_size:
    movi.n  a12, 5                     /* e5: in-flight total size changed */
    j       .Lart_reply_error_common
.Lart_error_order:
    movi.n  a12, 6                     /* e6: offset is not a fixed chunk boundary */
    j       .Lart_reply_error_common
.Lart_error_data_lookup:
    movi.n  a12, 7                     /* e7: direct data lookup returned null */
    j       .Lart_reply_error_common
.Lart_error_data_type:
    movi.n  a12, 8                     /* e8: lookup type byte is not 2/4/5 */
    j       .Lart_reply_error_common
.Lart_error_data_string:
    movi.n  a12, 9                     /* e9: mapped payload pointer is null */
    j       .Lart_reply_error_common
.Lart_error_decode:
    movi.n  a12, -1                    /* generic error: decoder rejected */
    j       .Lart_reply_error_common
.Lart_error_decoded_length:
    movi.n  a12, -1                    /* generic error: decoded length invalid */
.Lart_reply_error_common:
    mov     a10, a6
    mov     a11, a5
    mov     a13, a4
    call8   .Lreply_status_entry
    addi    a10, a1, 224
    l32r    a8, .Ljson_proxy_dtor_fn
    callx8  a8                         /* root owns any constructed proxy */
    retw.n
    .size music_id1_handle_art, . - music_id1_handle_art

/* a2=controller. This function is appended after every frozen vtable target;
 * the tiny existing refresh hook calls it without moving later stock symbols. */
    .balign 4
    .type music_id1_ui_refresh_transport, @function
.Lui_refresh_transport_entry:
music_id1_ui_refresh_transport:
    entry   a1, 224
    mov     a7, a2
    l32i.n  a5, a7, 28
    addi    a5, a5, 1
    s32i.n  a5, a7, 28
    l32i    a6, a7, 56
    beqz    a6, .Lui_transport_done

    /* Acquire one stable metadata generation into this UI stack frame. The
     * RPC task can begin the next write immediately after our second check;
     * LVGL therefore sees only the private copy, never shared mutable text. */
    memw
    l32i    a8, a6, 140
    extui   a10, a8, 0, 1
    bnez    a10, .Lui_transport_art
    l32i    a9, a6, 144
    bne     a8, a9, .Lui_transport_copy
    beqz    a8, .Lui_transport_art
    movi.n  a10, 1
    bne     a5, a10, .Lui_transport_art

.Lui_transport_copy:
    s32i    a8, a1, 156                /* first even generation */
    mov     a10, a6
    addi    a11, a1, 16
    movi.n  a8, 32                     /* title[64] + artist[64] */
.Lui_transport_copy_word:
    l32i.n  a9, a10, 0
    s32i.n  a9, a11, 0
    addi.n  a10, a10, 4
    addi.n  a11, a11, 4
    addi.n  a8, a8, -1
    bnez    a8, .Lui_transport_copy_word
    l32i    a8, a6, 128
    s32i    a8, a1, 144
    l32i    a8, a6, 132
    s32i    a8, a1, 148
    l32i    a8, a6, 136
    s32i    a8, a1, 152
    l32r    a8, .Laccent_value_offset
    add     a10, a6, a8
    l32i.n  a8, a10, 0
    s32i    a8, a1, 192
    l32i.n  a8, a10, 4
    s32i    a8, a1, 196
    memw
    l32i    a8, a6, 140
    l32i    a9, a1, 156
    bne     a8, a9, .Lui_transport_art
    extui   a10, a8, 0, 1
    bnez    a10, .Lui_transport_art

    l32i    a10, a7, 44
    beqz    a10, .Lui_transport_artist
    addi    a11, a1, 16
    l32r    a8, .Llabel_set_text
    callx8  a8
    l32i    a10, a7, 44
    movi.n  a11, 2                     /* TOP_MID */
    movi.n  a12, 0
    movi    a13, 82
    l32r    a8, .Lobject_align
    callx8  a8
.Lui_transport_artist:
    l32i    a10, a7, 48
    beqz    a10, .Lui_transport_time
    addi    a11, a1, 80
    l32r    a8, .Llabel_set_text
    callx8  a8
    l32i    a10, a7, 48
    movi.n  a11, 2
    movi.n  a12, 0
    movi    a13, 204
    l32r    a8, .Lobject_align
    callx8  a8
.Lui_transport_time:
    addi    a10, a1, 160
    l32i    a11, a1, 144
    l32i    a12, a1, 148
    call8   music_id1_format_time
    l32i    a10, a7, 52
    beqz    a10, .Lui_transport_commit
    addi    a11, a1, 160
    l32r    a8, .Llabel_set_text
    callx8  a8
    l32i    a10, a7, 52
    movi.n  a11, 2
    movi.n  a12, 0
    movi    a13, 236
    l32r    a8, .Lobject_align
    callx8  a8
.Lui_transport_commit:
    /* Accent parsing and all background/progress pixels run on wl_lvgl. The
     * renderer never races the RPC task and descriptor identity alternates on
     * every accepted metadata generation so LVGL cannot retain stale pixels. */
    addi    a10, a1, 192
    call8   music_id1_parse_accent
    bnez    a11, .Lui_transport_have_accent
    l32r    a8, .Lbackground_applied_offset
    add     a9, a6, a8
    l32i    a10, a9, 0
    bnez    a10, .Lui_transport_have_accent
    l32r    a10, .Lglow_6
.Lui_transport_have_accent:
    mov     a12, a10                    /* RGB24 accent */
    mov     a10, a7                     /* controller */
    mov     a11, a6                     /* transport state */
    l32i    a13, a1, 144                /* elapsed */
    l32i    a14, a1, 148                /* duration */
    call8   music_id1_apply_background
    l32i    a8, a1, 156
    s32i    a8, a6, 144
.Lui_transport_art:
    memw
    l32i    a8, a6, 200
    l32i    a9, a6, 204
    bne     a8, a9, .Lui_transport_art_apply
    beqz    a8, .Lui_transport_done
    movi.n  a10, 1
    bne     a5, a10, .Lui_transport_done
.Lui_transport_art_apply:
    s32i    a8, a1, 20
    l32i    a8, a6, 188
    s32i    a8, a6, 184
    addi    a5, a7, 64                 /* descriptor identity follows buffer 0 */
    beqz    a8, .Lui_transport_art_descriptor
    addi    a5, a7, 88                 /* descriptor identity follows buffer 1 */
.Lui_transport_art_descriptor:
    l32r    a8, .Ldescriptor_word_0
    s32i    a8, a5, 0
    l32r    a8, .Lart_descriptor_word_1
    s32i    a8, a5, 4
    l32r    a8, .Lart_descriptor_word_2
    s32i    a8, a5, 8
    l32r    a8, .Lartwork_bytes
    s32i    a8, a5, 12
    movi.n  a8, 0
    s32i    a8, a5, 20
    l32i    a8, a6, 184
    addi    a9, a6, 208
    beqz    a8, .Lui_transport_art_buffer
    l32r    a8, .Lartwork_buffer_1_offset
    add     a9, a6, a8
.Lui_transport_art_buffer:
    s32i    a9, a5, 16
    l32i    a10, a7, 40
    beqz    a10, .Lui_transport_art_commit
    mov     a11, a5
    l32r    a8, .Limage_set_src
    callx8  a8
.Lui_transport_art_commit:
    /* Composite through the already-live-proven full-screen image as well.
     * This bypasses any LVGL cache tied to the separate album image while the
     * paired album descriptors remain a safe fallback/diagnostic surface. */
    mov     a10, a6
    call8   music_id1_blit_active_art
    mov     a10, a7
    mov     a11, a6
    call8   music_id1_present_background
    l32i    a8, a1, 20
    s32i    a8, a6, 204
.Lui_transport_done:
    retw.n
    .size music_id1_ui_refresh_transport, . - music_id1_ui_refresh_transport

/* a2=destination,a3=elapsed seconds,a4=duration seconds. Fixed-width time
 * avoids allocation and remains valid for the life of the controller. */
    .balign 4
    .type music_id1_format_time, @function
music_id1_format_time:
    entry   a1, 48
    mov     a7, a2
    movi.n  a8, 60
    quou    a5, a3, a8
    remu    a6, a3, a8
    movi.n  a9, 99
    min     a5, a5, a9
    movi.n  a8, 10
    quou    a9, a5, a8
    remu    a10, a5, a8
    addi    a9, a9, 48
    addi    a10, a10, 48
    s8i     a9, a7, 0
    s8i     a10, a7, 1
    movi.n  a9, ':'
    s8i     a9, a7, 2
    quou    a9, a6, a8
    remu    a10, a6, a8
    addi    a9, a9, 48
    addi    a10, a10, 48
    s8i     a9, a7, 3
    s8i     a10, a7, 4
    movi.n  a9, ' '
    s8i     a9, a7, 5
    movi.n  a9, '/'
    s8i     a9, a7, 6
    movi.n  a9, ' '
    s8i     a9, a7, 7
    movi.n  a8, 60
    quou    a5, a4, a8
    remu    a6, a4, a8
    movi.n  a9, 99
    min     a5, a5, a9
    movi.n  a8, 10
    quou    a9, a5, a8
    remu    a10, a5, a8
    addi    a9, a9, 48
    addi    a10, a10, 48
    s8i     a9, a7, 8
    s8i     a10, a7, 9
    movi.n  a9, ':'
    s8i     a9, a7, 10
    quou    a9, a6, a8
    remu    a10, a6, a8
    addi    a9, a9, 48
    addi    a10, a10, 48
    s8i     a9, a7, 11
    s8i     a10, a7, 12
    movi.n  a8, 0
    s8i     a8, a7, 13
    retw.n
    .size music_id1_format_time, . - music_id1_format_time

/* Exact bounded parser for the host contract "#RRGGBB". a2=stack/RAM text;
 * returns a2=0xRRGGBB,a3=1 on exactly seven characters plus NUL. */
    .balign 4
    .type music_id1_parse_accent, @function
music_id1_parse_accent:
    entry   a1, 32
    mov     a7, a2
    l8ui    a8, a7, 0
    movi.n  a9, '#'
    bne     a8, a9, .Laccent_parse_failure
    addi.n  a7, a7, 1
    movi.n  a6, 0
    movi.n  a5, 0
.Laccent_parse_digit:
    l8ui    a8, a7, 0
    movi.n  a9, '0'
    bltu    a8, a9, .Laccent_parse_failure
    movi.n  a10, '9' + 1
    bltu    a8, a10, .Laccent_parse_decimal
    movi.n  a9, 'A'
    bltu    a8, a9, .Laccent_parse_lower
    movi.n  a10, 'F' + 1
    bltu    a8, a10, .Laccent_parse_upper
.Laccent_parse_lower:
    movi.n  a9, 'a'
    bltu    a8, a9, .Laccent_parse_failure
    movi.n  a10, 'f' + 1
    bgeu    a8, a10, .Laccent_parse_failure
    addi    a8, a8, 10 - 'a'
    j       .Laccent_parse_accumulate
.Laccent_parse_upper:
    addi    a8, a8, 10 - 'A'
    j       .Laccent_parse_accumulate
.Laccent_parse_decimal:
    addi    a8, a8, -'0'
.Laccent_parse_accumulate:
    slli    a6, a6, 4
    or      a6, a6, a8
    addi.n  a7, a7, 1
    addi.n  a5, a5, 1
    bltui   a5, 6, .Laccent_parse_digit
    l8ui    a8, a7, 0
    bnez    a8, .Laccent_parse_failure
    mov     a2, a6
    movi.n  a3, 1
    retw.n
.Laccent_parse_failure:
    movi.n  a2, 0
    movi.n  a3, 0
    retw.n
    .size music_id1_parse_accent, . - music_id1_parse_accent

/* a2=transport state,a3=0xRRGGBB. Render a whole logical 100x310 RGB565
 * normalized ellipse in one LVGL callback. Half-pixel coordinates make both
 * axes exactly mirror-symmetric. q=(dx/99)^2+(dy/309)^2 and the color weight
 * is max(0,1-q)^2. Thus all four physical edges are exactly black.
 *
 * The prior live version performed six integer divisions for every pixel and
 * took roughly 40 seconds to apply a new album accent. This version builds the
 * 100-entry horizontal q table once, computes one vertical q per row, and uses
 * a Q16 shift-plus-correction approximation inside the pixel loop. The hot
 * loop contains no division; the entire frame needs only 410 divisions. */
    .balign 4
    .type music_id1_render_background, @function
music_id1_render_background:
    entry   a1, 480
    l32r    a8, .Lbackground_buffer_offset
    add     a7, a2, a8
    extui   a8, a3, 16, 8
    s32i    a8, a1, 16                 /* red */
    extui   a8, a3, 8, 8
    s32i    a8, a1, 20                 /* green */
    extui   a8, a3, 0, 8
    s32i    a8, a1, 24                 /* blue */

    /* Precompute qx=(abs(2*x-99)*255/99)^2 into a stack-local table. */
    addi    a6, a1, 64
    movi.n  a4, 0
.Lbackground_x_setup:
    movi.n  a8, 99
    slli    a9, a4, 1
    sub     a10, a8, a9
    sub     a11, a9, a8
    max     a9, a10, a11
    movi    a8, 255
    mull    a9, a9, a8
    movi.n  a10, 99
    quou    a9, a9, a10
    mull    a9, a9, a9
    s32i.n  a9, a6, 0
    addi.n  a6, a6, 4
    addi.n  a4, a4, 1
    movi.n  a8, 100
    bltu    a4, a8, .Lbackground_x_setup

    movi.n  a5, 0                      /* y */
.Lbackground_y:
    movi    a8, 309
    slli    a9, a5, 1
    sub     a10, a8, a9
    sub     a11, a9, a8
    max     a3, a10, a11               /* abs(2*y-309) */
    movi    a8, 255
    mull    a3, a3, a8
    movi    a8, 309
    quou    a3, a3, a8
    mull    a3, a3, a3                 /* qy in Q16 */
    addi    a6, a1, 64                 /* restart qx table */
    movi.n  a4, 0                      /* x */
.Lbackground_x:
    l32i.n  a10, a6, 0
    addi.n  a6, a6, 4
    add     a10, a10, a3               /* q in Q16: qx^2 + qy^2 */
    l32r    a9, .Lradial_one_q16
    bgeu    a10, a9, .Lbackground_black
    sub     a10, a9, a10
    mull    a10, a10, a10
    l32r    a11, .Lradial_round_q16
    add     a10, a10, a11
    srli    a11, a10, 16
    srli    a10, a10, 23
    add     a10, a10, a11              /* ~= (65025-q)^2/65025 */

    l32i    a8, a1, 16
    mull    a8, a8, a10
    l32r    a11, .Lradial_round_q16
    add     a8, a8, a11
    srli    a11, a8, 23
    srli    a8, a8, 16
    add     a8, a8, a11
    srli    a8, a8, 3
    slli    a8, a8, 11
    l32i    a11, a1, 20
    mull    a11, a11, a10
    l32r    a9, .Lradial_round_q16
    add     a11, a11, a9
    srli    a9, a11, 23
    srli    a11, a11, 16
    add     a11, a11, a9
    srli    a11, a11, 2
    slli    a11, a11, 5
    or      a8, a8, a11
    l32i    a11, a1, 24
    mull    a11, a11, a10
    l32r    a9, .Lradial_round_q16
    add     a11, a11, a9
    srli    a9, a11, 23
    srli    a11, a11, 16
    add     a11, a11, a9
    srli    a11, a11, 3
    or      a8, a8, a11
    j       .Lbackground_store
.Lbackground_black:
    movi.n  a8, 0
.Lbackground_store:
    s16i    a8, a7, 0
    addi.n  a7, a7, 2
    addi.n  a4, a4, 1
    movi.n  a8, 100
    bltu    a4, a8, .Lbackground_x
    addi.n  a5, a5, 1
    movi    a8, 310
    bltu    a5, a8, .Lbackground_y
    memw
    retw.n
    .size music_id1_render_background, . - music_id1_render_background

/* a2=state,a3=accent,a4=elapsed,a5=duration. The actual 80x5 progress bar is
 * baked into the background image at logical x=10..89,y=272..276. */
    .balign 4
    .type music_id1_render_progress, @function
music_id1_render_progress:
    entry   a1, 48
    mov     a6, a3
    movi.n  a3, 0                      /* bounded fill width */
    beqz    a5, .Lprogress_fill_ready
    movi.n  a8, 0
    max     a4, a4, a8
    min     a4, a4, a5
    movi.n  a8, 80
    mull    a4, a4, a8
    quou    a3, a4, a5
.Lprogress_fill_ready:
    extui   a8, a6, 16, 8
    srli    a8, a8, 3
    slli    a8, a8, 11
    extui   a9, a6, 8, 8
    srli    a9, a9, 2
    slli    a9, a9, 5
    or      a8, a8, a9
    extui   a9, a6, 0, 8
    srli    a9, a9, 3
    or      a6, a8, a9                 /* accent RGB565 */
    l32r    a8, .Lprogress_buffer_offset
    add     a7, a2, a8
    movi.n  a5, 0                      /* row */
.Lprogress_row:
    movi.n  a4, 0                      /* column */
.Lprogress_column:
    l32r    a8, .Lprogress_track_pixel
    bgeu    a4, a3, .Lprogress_store
    mov     a8, a6
.Lprogress_store:
    s16i    a8, a7, 0
    addi.n  a7, a7, 2
    addi.n  a4, a4, 1
    movi.n  a8, 80
    bltu    a4, a8, .Lprogress_column
    addi    a7, a7, 40                 /* row tail 20B + next-row x offset 20B */
    addi.n  a5, a5, 1
    bltui   a5, 5, .Lprogress_row
    memw
    retw.n
    .size music_id1_render_progress, . - music_id1_render_progress

/* a2=controller. Create the full-screen background image before album/text. */
    .balign 4
    .type music_id1_build_background, @function
music_id1_build_background:
    entry   a1, 80
    mov     a7, a2
    l32i    a6, a7, 56
    beqz    a6, .Lbackground_build_done
    l32r    a8, .Lbackground_buffer_offset
    add     a5, a6, a8
    addi    a4, a7, 112
    l32r    a8, .Ldescriptor_word_0
    s32i    a8, a4, 0
    l32r    a8, .Lbackground_descriptor_word_1
    s32i    a8, a4, 4
    l32r    a8, .Lbackground_descriptor_word_2
    s32i    a8, a4, 8
    l32r    a8, .Lbackground_bytes
    s32i    a8, a4, 12
    s32i    a5, a4, 16
    movi.n  a8, 0
    s32i    a8, a4, 20
    addi    a4, a7, 136
    l32r    a8, .Ldescriptor_word_0
    s32i    a8, a4, 0
    l32r    a8, .Lbackground_descriptor_word_1
    s32i    a8, a4, 4
    l32r    a8, .Lbackground_descriptor_word_2
    s32i    a8, a4, 8
    l32r    a8, .Lbackground_bytes
    s32i    a8, a4, 12
    s32i    a5, a4, 16
    movi.n  a8, 0
    s32i    a8, a4, 20

    l32r    a8, .Lbackground_applied_offset
    add     a5, a6, a8
    l32i    a4, a5, 0
    bnez    a4, .Lbackground_pixels_ready
    l32r    a4, .Lglow_6
    mov     a10, a6
    mov     a11, a4
    call8   music_id1_render_background
    mov     a10, a6
    mov     a11, a4
    movi.n  a12, 0
    movi.n  a13, 0
    call8   music_id1_render_progress
    s32i    a4, a5, 0
.Lbackground_pixels_ready:
    l32i.n  a10, a7, 12
    l32r    a8, .Limage_create
    callx8  a8
    beqz    a10, .Lbackground_build_done
    s32i    a10, a7, 60
    l32r    a8, .Lbackground_active_offset
    add     a5, a6, a8
    l32i    a8, a5, 0
    addi    a11, a7, 112
    beqz    a8, .Lbackground_build_set_src
    addi    a11, a7, 136
.Lbackground_build_set_src:
    l32r    a8, .Limage_set_src
    callx8  a8
    l32i    a10, a7, 60
    movi.n  a11, 9                     /* CENTER */
    movi.n  a12, 0
    movi.n  a13, 0
    l32r    a8, .Lobject_align
    callx8  a8
.Lbackground_build_done:
    retw.n
    .size music_id1_build_background, . - music_id1_build_background

/* a2=controller,a3=state,a4=accent,a5=elapsed,a6=duration. Regenerate the
 * ellipse only when accent changes, redraw the five-row progress bar on every
 * metadata generation, then alternate the descriptor identity. */
    .balign 4
    .type music_id1_apply_background, @function
music_id1_apply_background:
    entry   a1, 80
    mov     a7, a2
    s32i    a4, a1, 16
    s32i    a5, a1, 20
    s32i    a6, a1, 24
    mov     a6, a3
    l32r    a8, .Lbackground_applied_offset
    add     a5, a6, a8
    l32i    a8, a5, 0
    beq     a8, a4, .Lbackground_apply_progress
    mov     a10, a6
    mov     a11, a4
    call8   music_id1_render_background
    l32i    a4, a1, 16
    s32i    a4, a5, 0
.Lbackground_apply_progress:
    mov     a10, a6
    l32i    a11, a1, 16
    l32i    a12, a1, 20
    l32i    a13, a1, 24
    call8   music_id1_render_progress
    mov     a10, a6
    call8   music_id1_blit_active_art
    memw
    mov     a10, a7
    mov     a11, a6
    call8   music_id1_present_background
.Lbackground_apply_done:
    retw.n
    .size music_id1_apply_background, . - music_id1_apply_background

/* a2=state. Copy the accepted active 80x80 RGB565 image into the proven
 * 100x310 UI-owned background at logical x=10..89,y=115..194. */
    .balign 4
    .type music_id1_blit_active_art, @function
music_id1_blit_active_art:
    entry   a1, 48
    mov     a7, a2
    l32i    a8, a7, 200                /* no accepted artwork yet */
    beqz    a8, .Lalbum_blit_done
    addi    a6, a7, 208                /* active buffer 0 */
    l32i    a8, a7, 184
    beqz    a8, .Lalbum_blit_source
    l32r    a8, .Lartwork_buffer_1_offset
    add     a6, a7, a8                 /* active buffer 1 */
.Lalbum_blit_source:
    l32r    a8, .Lalbum_background_offset
    add     a5, a7, a8
    movi.n  a4, 0                      /* row */
.Lalbum_blit_row:
    movi.n  a3, 0                      /* 32-bit words */
.Lalbum_blit_word:
    l32i.n  a8, a6, 0
    s32i.n  a8, a5, 0
    addi.n  a6, a6, 4
    addi.n  a5, a5, 4
    addi.n  a3, a3, 1
    movi.n  a8, 40
    bltu    a3, a8, .Lalbum_blit_word
    addi    a5, a5, 40                 /* background row tail */
    addi.n  a4, a4, 1
    movi.n  a8, 80
    bltu    a4, a8, .Lalbum_blit_row
    memw
.Lalbum_blit_done:
    retw.n
    .size music_id1_blit_active_art, . - music_id1_blit_active_art

/* a2=controller,a3=state. Alternate full-screen descriptor identity after all
 * background/progress/album pixels are complete on wl_lvgl. */
    .balign 4
    .type music_id1_present_background, @function
music_id1_present_background:
    entry   a1, 48
    mov     a7, a2
    mov     a6, a3
    l32r    a8, .Lbackground_active_offset
    add     a5, a6, a8
    l32i    a8, a5, 0
    movi.n  a9, 1
    xor     a8, a8, a9
    s32i    a8, a5, 0
    addi    a11, a7, 112
    beqz    a8, .Lbackground_present_descriptor
    addi    a11, a7, 136
.Lbackground_present_descriptor:
    l32i    a10, a7, 60
    beqz    a10, .Lbackground_present_done
    l32r    a8, .Limage_set_src
    callx8  a8
.Lbackground_present_done:
    retw.n
    .size music_id1_present_background, . - music_id1_present_background
