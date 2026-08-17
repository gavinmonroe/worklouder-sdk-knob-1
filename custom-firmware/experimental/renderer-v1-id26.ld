ENTRY(renderer_v1_register_id26)

SECTIONS
{
  /* Provisional audit address.  The combined b9b8-preserving linker owns the
   * final append address and must relink this object; raw-byte copying is not
   * permitted. */
  . = 0x42119000;

  .renderer_v1_literal : ALIGN(4)
  {
    *(.literal)
    *(.literal.*)
  }

  .renderer_v1_text : ALIGN(4)
  {
    *(.text.renderer_v1)
    *(.text)
    *(.text.*)
  }

  .renderer_v1_rodata : ALIGN(4)
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

ASSERT(SIZEOF(.renderer_v1_rodata) == 0,
  "renderer-v1 must not dereference ordinary data placed in executable IROM")
