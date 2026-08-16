ENTRY(music_id1_register)

SECTIONS
{
  /* Provisional audit address only; the combined linker owns final placement. */
  . = 0x42118000;

  .music_id1_literal : ALIGN(4)
  {
    KEEP(*(.literal.music_id1))
  }

  .music_id1_text : ALIGN(4)
  {
    KEEP(*(.text.music_id1))
  }

  /DISCARD/ :
  {
    *(.comment)
    *(.xtensa.info)
  }
}
