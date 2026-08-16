/* Stage-3D appends after the exact live-tested Stage-3C.1 IROM tail. */
ENTRY(stage3d_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3d_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3d_wpm_pet))
  }

  .stage3d_text : ALIGN(4)
  {
    KEEP(*(.text.stage3d_wpm_pet))
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
