ENTRY(stage3e1_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3e1_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e1_wpm_sprite))
  }

  .stage3e1_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e1_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}

