ENTRY(renderer_v2_native_attach)

SECTIONS
{
  /* Provisional audit address. The combined 49cb-preserving linker owns the
   * final append address and relinks this object; raw copying is forbidden. */
  . = 0x4211b000;

  .renderer_v2_literal : ALIGN(4)
  {
    *(.literal)
    *(.literal.*)
  }

  .renderer_v2_text : ALIGN(4)
  {
    *(.text.renderer_v2)
    *(.text)
    *(.text.*)
  }

  .renderer_v2_rodata : ALIGN(4)
  {
    *(.rodata)
    *(.rodata.*)
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
    *(.xt.lit)
    *(.xt.prop)
    *(.eh_frame)
    *(.eh_frame.*)
  }
}

ASSERT(SIZEOF(.renderer_v2_rodata) == 0,
  "renderer-v2 must not dereference ordinary data placed in executable IROM")
