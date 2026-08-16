ENTRY(stage3e34_register_wpm)

SECTIONS
{
  . = 0x42116f10;

  .stage3e34_register_literal : ALIGN(4)
  {
    KEEP(*(.literal.stage3e34_wpm_sprite))
  }

  .stage3e34_register_text : ALIGN(4)
  {
    KEEP(*(.text.stage3e34_wpm_sprite))
  }

  /DISCARD/ :
  {
    *(.literal.stage3e34_setup)
    *(.text.stage3e34_setup)
    *(.comment)
    *(.xtensa.info)
  }
}
