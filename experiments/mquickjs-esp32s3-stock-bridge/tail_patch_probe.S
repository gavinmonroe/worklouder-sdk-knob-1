    .section .text.stock_bridge.patch,"ax",@progbits
    .global framer_stock_bridge_setup_tail_patch_probe
    .type framer_stock_bridge_setup_tail_patch_probe,@function
framer_stock_bridge_setup_tail_patch_probe:
    j       framer_stock_bridge_tail_trampoline
    .size framer_stock_bridge_setup_tail_patch_probe,.-framer_stock_bridge_setup_tail_patch_probe
