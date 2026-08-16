/* Stage-3C.1 replaces Stage-3C at the same post-Stage-3B append boundary. */
ENTRY(stage3c1_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116d2c;

  .stage3c1_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3c1_wpm))
  }

  .stage3c1_text : ALIGN(4)
  {
    KEEP(*(.text.stage3c1_wpm))
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
