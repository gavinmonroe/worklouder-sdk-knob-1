ENTRY(renderer_v2_combined_registration_chain)
SECTIONS {
  . = 0x421187cc;
  .renderer_v2 : ALIGN(4) {
    KEEP(*(.literal.renderer_v2_chain))
    *(.literal)
    *(.literal.*)
    KEEP(*(.text.renderer_v2_chain))
    KEEP(*(.text.renderer_v2_native))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
  }
  .renderer_v2_rodata : ALIGN(4) { *(.rodata) *(.rodata.*) }
  /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame) *(.eh_frame.*) }
}
ASSERT(SIZEOF(.renderer_v2_rodata) == 0, "render-v2 native module must not dereference IROM rodata")
