ENTRY(framer_mqjs_module_probe)
EXTERN(framer_physical_module_startup)
EXTERN(framer_physical_weather_id)
EXTERN(framer_physical_key_after_stock)
EXTERN(framer_physical_block_allocation_bytes)

SECTIONS
{
  .text 0x423d0000 : ALIGN(16)
  {
    *(.literal .literal.*)
    *(.text .text.*)
    . = ALIGN(16);
  }

  .rodata 0x3c3f0000 : ALIGN(16)
  {
    KEEP(*(.rodata.framer_mqjs_descriptor))
    KEEP(*(.rodata.physical_assets))
    *(.rodata .rodata.*)
    . = ALIGN(16);
  }

  .data : { *(.data .data.*) }
  .bss (NOLOAD) : { *(.bss .bss.* COMMON) }

  /DISCARD/ :
  {
    *(.comment .xtensa.info .xt.lit .xt.prop)
    *(.eh_frame .eh_frame.*)
  }
}

ASSERT(SIZEOF(.text) <= 0x20000, "physical canary text exceeds two MMU pages")
ASSERT(SIZEOF(.rodata) <= 0x10000, "physical canary data exceeds one MMU page")
ASSERT(SIZEOF(.data) == 0, "physical canary gained writable flash data")
ASSERT(SIZEOF(.bss) == 0, "physical canary gained an unsafe fixed BSS")
