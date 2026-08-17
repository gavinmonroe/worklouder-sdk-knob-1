ENTRY(framer_physical_tail_trampoline)

PROVIDE(esp_mmu_map = 0x420f539c);
PROVIDE(esp_mmu_unmap = 0x420f5774);

SECTIONS
{
  .text 0x4211e460 : ALIGN(4)
  {
    KEEP(*(.text.physical_tail))
    KEEP(*(.text.physical_loader_start))
    KEEP(*(.text.physical_key_wrapper))
    *(.literal .literal.*)
    *(.text .text.*)
    . = ALIGN(4);
  }
  /DISCARD/ :
  {
    *(.rodata .rodata.* .data .data.* .bss .bss.*)
    *(.comment .xtensa.info .xt.lit .xt.prop .eh_frame .eh_frame.*)
  }
}

ASSERT(SIZEOF(.text) <= 0x1ab8, "resident loader exceeds accepted zero tail")
