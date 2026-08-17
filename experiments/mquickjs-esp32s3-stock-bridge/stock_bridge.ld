/* Absolute-call fragment for the one accepted healthy application only.
 * verify.mjs hashes every corresponding function span before this fragment is
 * used.  This fragment does not place resident code and cannot build firmware. */
PROVIDE(framer_stock_heap_caps_free = 0x4037e250);
PROVIDE(framer_stock_heap_caps_malloc = 0x4037e55c);
PROVIDE(framer_stock_heap_caps_get_free_size = 0x420c8200);
PROVIDE(framer_stock_heap_caps_get_largest_free_block = 0x420c82c4);
PROVIDE(framer_stock_task_create_static_pinned = 0x4038e950);
PROVIDE(framer_stock_task_delete = 0x4038db48);
PROVIDE(framer_stock_task_current_for_core = 0x4038eb7c);
PROVIDE(framer_stock_key_callback_original = 0x4206eae0);
PROVIDE(framer_stock_rpc_registry = 0x42004afc);
PROVIDE(framer_stock_rpc_register_one = 0x4211b7c8);
PROVIDE(framer_stock_rpc_reply_status = 0x4211ba58);
