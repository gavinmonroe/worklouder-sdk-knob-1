.section .literal.renderer_v2_chain,"a",@progbits
.balign 4
.Lwpm_register: .long 0x421170cc
.Loperator_new: .long 0x420e7c04
.Lcompressed_assets: .long 0x3c1cf400
.Lcompressed_asset_bytes: .long 3055
.Lbase_bundle_bytes: .long 748
.Lf2ep_bytes: .long 9536
.Lasset_ram_bytes: .long 10284
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
 beqz a10,.Lrender_v2_chain_done
 mov a6,a10
 l32r a10,.Lasset_ram_bytes
 l32r a8,.Loperator_new
 callx8 a8
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a7,a10
 mov a10,a7
 l32r a11,.Lasset_ram_bytes
 l32r a12,.Lcompressed_assets
 l32r a13,.Lcompressed_asset_bytes
 call8 renderer_v2_decode_assets
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a10,a6
 mov a11,a7
 l32r a12,.Lbase_bundle_bytes
 call8 renderer_v1_stage_bundle
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a10,a6
 call8 renderer_v1_tick
 mov a10,a4
 mov a11,a5
 mov a12,a6
 movi a13,748
 add a13,a7,a13
 l32r a14,.Lf2ep_bytes
 call8 renderer_v2_native_attach
.Lrender_v2_register_scene_rpc:
 mov a10,a6
 call8 renderer_scene_rpc_register
 beqz a10,.Lrender_v2_chain_done
 movi.n a8,1
 s32i.n a8,a10,8
 memw
 mov a11,a10
 mov a10,a6
 call8 renderer_v2_rpc_register
.Lrender_v2_chain_done:
 retw.n
.size renderer_v2_combined_registration_chain,.-renderer_v2_combined_registration_chain
