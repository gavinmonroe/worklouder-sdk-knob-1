    .section .literal.physical_rpc,"a",@progbits
    .balign 4
.Lphysical_read_integer: .long 0x4211ba2c
.Lphysical_json_lookup: .long 0x42005560
.Lphysical_json_string_tuple: .long 0x420046e0

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

    .balign 4
    .global framer_physical_rpc_read_string
    .type framer_physical_rpc_read_string,@function
/* C ABI: a2=root,a3=key,a4=keyBytes,a5=&pointer,a6=&length. Returns 1 when the
 * key is present as a string. The pointer aims into the live request JSON and
 * is valid only inside the RPC handler. Same 64-byte STOCK_ROOT_MAKE object
 * and the same stock pair the field-proven music-player artwork path uses:
 * direct lookup 0x42005560(root+56,key,keyBytes,1,root) yields a JsonVariant
 * node, 0x420046e0(node) converts it to the exact (pointer,length) tuple. */
framer_physical_rpc_read_string:
    entry   a1,48
    s32i    a5,a1,16
    s32i    a6,a1,20
    mov     a7,a2
    addi    a10,a7,56
    mov     a11,a3
    mov     a12,a4
    movi.n  a13,1
    mov     a14,a7
    l32r    a8,.Lphysical_json_lookup
    callx8  a8
    beqz    a10,.Lphysical_read_string_missing
    l32r    a8,.Lphysical_json_string_tuple
    callx8  a8
    beqz    a10,.Lphysical_read_string_missing
    l32i    a5,a1,16
    l32i    a6,a1,20
    beqz    a5,.Lphysical_read_string_missing
    beqz    a6,.Lphysical_read_string_missing
    s32i.n  a10,a5,0
    s32i.n  a11,a6,0
    movi.n  a2,1
    retw.n
.Lphysical_read_string_missing:
    movi.n  a2,0
    retw.n
    .size framer_physical_rpc_read_string,.-framer_physical_rpc_read_string
