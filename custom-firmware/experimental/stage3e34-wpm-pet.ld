ENTRY(stage3e34_screen_setup_wrapper)

SECTIONS
{
  . = 0x42116f10;

  .stage3e34_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e34_setup))
    KEEP(*(.literal.stage3e34_wpm_sprite))
  }

  .stage3e34_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e34_setup))
    KEEP(*(.text.stage3e34_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}
