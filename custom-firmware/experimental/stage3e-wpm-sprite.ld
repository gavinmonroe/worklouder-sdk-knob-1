ENTRY(stage3e_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3e_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e_wpm_sprite))
  }

  .stage3e_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}

