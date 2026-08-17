.section .literal.renderer_v2_chain,"a",@progbits
.balign 4
.Lwpm_register: .long 0x421170cc
.section .text.renderer_v2_chain,"ax",@progbits
.balign 4
.global renderer_v2_combined_registration_chain
.type renderer_v2_combined_registration_chain,@function
renderer_v2_combined_registration_chain:
 entry a1,64
 mov a4,a2
 mov a5,a3
 mov a10,a4
 mov a11,a5
 l32r a8,.Lwpm_register
 callx8 a8
 mov a10,a4
 mov a11,a5
 call8 renderer_v1_register_id26
 beqz a10,.Lgeneric_chain_done
 mov a6,a10
 mov a10,a4
 mov a11,a5
 mov a12,a6
 movi.n a13,0
 movi.n a14,0
 call8 renderer_v2_native_attach
 beqz a10,.Lgeneric_chain_done
 mov a10,a6
 call8 renderer_scene_rpc_register
 beqz a10,.Lgeneric_chain_done
 mov a11,a10
 mov a10,a6
 call8 renderer_v2_rpc_register
.Lgeneric_chain_done:
 retw.n
.size renderer_v2_combined_registration_chain,.-renderer_v2_combined_registration_chain
