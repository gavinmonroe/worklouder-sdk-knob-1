#include "physical_integration.c"
#include <stddef.h>
__attribute__((used, section(".probe")))
const unsigned int framer_probe_values[] = {
    (unsigned int)(sizeof(physical_block)),
    (unsigned int)(offsetof(physical_block, magic)),
    (unsigned int)(offsetof(physical_block, sources_enabled)),
    (unsigned int)(offsetof(physical_block, boot_state)),
    (unsigned int)(offsetof(physical_block, rpc_ready)),
    (unsigned int)(offsetof(physical_block, boot_started_ms)),
    (unsigned int)(offsetof(physical_block, boot_finished_ms)),
    (unsigned int)(offsetof(physical_block, task_handle)),
    (unsigned int)(offsetof(physical_block, owner)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, runtime)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, capability) + offsetof(framer_resident_capability, ready_mask)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, capability) + offsetof(framer_resident_capability, state)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) + offsetof(framer_f2js_admission, generation)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) + offsetof(framer_f2js_admission, key_count)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) + offsetof(framer_f2js_admission, events)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, heap)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, source_quiesce_state)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, telemetry) + offsetof(framer_resident_telemetry, last_result)),
    (unsigned int)(offsetof(physical_block, owner) + offsetof(framer_resident_owner, telemetry) + offsetof(framer_resident_telemetry, booted)),
};
