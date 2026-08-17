ENTRY(framer_mqjs_map_canary)

PROVIDE(esp_mmu_map = 0x420f539c);
PROVIDE(esp_mmu_unmap = 0x420f5774);

MEMORY
{
  loader_text (rx) : ORIGIN = 0x4211e460, LENGTH = 0x1ab8
}

SECTIONS
{
  .text : ALIGN(4)
  {
    *(.literal .literal.* .gnu.linkonce.literal.*)
    *(.text .text.* .gnu.linkonce.t.*)
  } > loader_text

  .forbidden_storage 0 (NOLOAD) :
  {
    *(.rodata .rodata.* .srodata .srodata.* .gnu.linkonce.r.*)
    *(.data .data.* .sdata .sdata.* .gnu.linkonce.d.*)
    *(.bss .bss.* .sbss .sbss.* COMMON)
  }

  /DISCARD/ :
  {
    *(.comment .note .note.* .eh_frame .eh_frame.*)
    *(.xtensa.info .xt.prop .xt.lit .debug* .gnu.attributes)
  }

  ASSERT(SIZEOF(.text) <= LENGTH(loader_text), "resident loader exceeds healthy blue-app cavity tail")
  ASSERT(SIZEOF(.forbidden_storage) == 0, "resident loader gained rodata or writable storage")
}
