ENTRY(stage3e3a_screen_setup_wrapper)

SECTIONS
{
  /* Exact post-C1 append boundary used by the live-proven Stage-3E path. */
  . = 0x42116f10;

  .stage3e3a_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e3a_i4))
  }

  .stage3e3a_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e3a_i4))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.note.GNU-stack)
    *(.xtensa.info)
    *(.xt.lit)
    *(.xt.prop)
  }
}
