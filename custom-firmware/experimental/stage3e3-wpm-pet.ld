ENTRY(stage3e3_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3e3_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e3_wpm_sprite))
  }

  .stage3e3_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e3_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}

