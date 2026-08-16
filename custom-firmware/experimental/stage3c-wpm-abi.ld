/* Offline link layout; starts at the end of the current Stage-3B IROM. */
ENTRY(stage3c_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116d2c;

  .stage3c_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3c_wpm))
  }

  .stage3c_text : ALIGN(4)
  {
    KEEP(*(.text.stage3c_wpm))
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
