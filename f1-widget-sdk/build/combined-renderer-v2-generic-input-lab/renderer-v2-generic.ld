ENTRY(renderer_v2_combined_registration_chain)
SECTIONS {
  . = 0x421187cc;
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
