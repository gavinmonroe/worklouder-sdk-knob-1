    .section .text.physical_tail,"ax",@progbits
    .balign 4
    .global framer_physical_tail_trampoline
    .type framer_physical_tail_trampoline,@function
/* Entry-less target of the accepted setup function's three-byte tail jump.
 * The success path has ID26 in a6, but the shared ID26-create failure branch
 * can leave a6 indeterminate. Pass it opaquely: the loader proves the complete
 * controller/vtable/sidecar identity before allocation or the first MMU map. */
framer_physical_tail_trampoline:
    mov.n   a10,a6
    call8   framer_physical_loader_start
    retw.n
    .size framer_physical_tail_trampoline,.-framer_physical_tail_trampoline
