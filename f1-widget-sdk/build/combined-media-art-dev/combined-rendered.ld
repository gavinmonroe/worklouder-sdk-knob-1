ENTRY(f1_combined_setup_wrapper)
SECTIONS {
  . = 0x42116f10;
  .combined_literal : ALIGN(4) {
    KEEP(*(.literal.f1_combined_setup))
    KEEP(*(.literal.stage3e34_wpm_sprite))
    KEEP(*(.literal.music_id1))
  }
  .combined_text : ALIGN(4) {
    KEEP(*(.text.f1_combined_setup))
    KEEP(*(.text.stage3e34_wpm_sprite))
    KEEP(*(.text.music_id1))
    . = ALIGN(4);
  }
  /DISCARD/ : {
    *(.literal.stage3e34_setup)
    *(.text.stage3e34_setup)
    *(.comment)
    *(.xtensa.info)
  }
}
