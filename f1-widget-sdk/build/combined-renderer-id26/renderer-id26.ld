ENTRY(renderer_id26_registration_chain)
SECTIONS {
  . = 0x421187cc;
  .renderer_id26 : ALIGN(4) {
    KEEP(*(.literal.renderer_chain))
    *(.literal)
    *(.literal.*)
    KEEP(*(.text.renderer_chain))
    KEEP(*(.text.renderer_v1))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
  }
  .renderer_rodata : ALIGN(4) { *(.rodata) *(.rodata.*) }
  /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame) *(.eh_frame.*) }
}
ASSERT(SIZEOF(.renderer_rodata) == 0, "renderer-v1 must not dereference IROM rodata")
