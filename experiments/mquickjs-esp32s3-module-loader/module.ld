ENTRY(framer_mqjs_module_probe)

MEMORY
{
  module_text (rx) : ORIGIN = 0x423d0000, LENGTH = 0x20000
  module_rodata (r) : ORIGIN = 0x3c3f0000, LENGTH = 0x10000
}

SECTIONS
{
  .text : ALIGN(4)
  {
    *(.literal .literal.* .gnu.linkonce.literal.*)
    *(.text .text.* .gnu.linkonce.t.*)
  } > module_text

  .rodata : ALIGN(16)
  {
    KEEP(*(.rodata.framer_mqjs_descriptor))
    *(.rodata .rodata.* .srodata .srodata.* .gnu.linkonce.r.*)
  } > module_rodata

  .forbidden_data 0 (NOLOAD) :
  {
    *(.data .data.* .sdata .sdata.* .gnu.linkonce.d.*)
    *(.bss .bss.* .sbss .sbss.* COMMON)
    *(.init_array .init_array.* .fini_array .fini_array.*)
  }

  /DISCARD/ :
  {
    *(.comment .note .note.* .eh_frame .eh_frame.*)
    *(.xtensa.info .xt.prop .xt.lit .debug* .gnu.attributes)
  }

  ASSERT(SIZEOF(.text) <= LENGTH(module_text), "MicroQuickJS text exceeds two mapped pages")
  ASSERT(SIZEOF(.rodata) <= LENGTH(module_rodata), "MicroQuickJS rodata exceeds one mapped page")
  ASSERT(SIZEOF(.forbidden_data) == 0, "MicroQuickJS module gained writable/static storage")
}
