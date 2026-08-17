    .section .literal.physical_rpc,"a",@progbits
    .balign 4
.Lphysical_read_integer: .long 0x4211ba2c

    .section .text.physical_rpc,"ax",@progbits
    .balign 4
    .global framer_physical_rpc_read_integer
    .type framer_physical_rpc_read_integer,@function
/* C ABI: a2=root,a3=key,a4=keyBytes,a5=out. The stock helper returns the
 * signed value in a10 and its independent presence bit in a11. */
framer_physical_rpc_read_integer:
    entry   a1,32
    mov     a7,a5
    mov     a10,a2
    mov     a11,a3
    mov     a12,a4
    l32r    a8,.Lphysical_read_integer
    callx8  a8
    beqz    a11,.Lphysical_read_missing
    beqz    a7,.Lphysical_read_missing
    s32i.n  a10,a7,0
    movi.n  a2,1
    retw.n
.Lphysical_read_missing:
    movi.n  a2,0
    retw.n
    .size framer_physical_rpc_read_integer,.-framer_physical_rpc_read_integer
