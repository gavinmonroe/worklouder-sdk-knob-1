    .section .text.stock_bridge.tail,"ax",@progbits
    .balign 4
    .global framer_stock_bridge_tail_trampoline
    .type framer_stock_bridge_tail_trampoline,@function

/* Entry-less on purpose.  The exact setup-chain tail is a retw.n, so a
 * three-byte J transfers the still-live setup window here.  On the successful
 * registration path a6 is the ID26 controller.  framer_stock_bridge_startup
 * rejects it without dereference if the earlier registration path failed and
 * left a6 indeterminate. */
framer_stock_bridge_tail_trampoline:
    mov     a10,a6
    call8   framer_stock_bridge_startup
    retw.n
    .size framer_stock_bridge_tail_trampoline,.-framer_stock_bridge_tail_trampoline
