ENTRY(stage3e2_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3e2_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e2_wpm_sprite))
  }

  .stage3e2_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e2_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}

