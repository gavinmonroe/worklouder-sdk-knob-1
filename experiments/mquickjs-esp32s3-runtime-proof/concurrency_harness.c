#include "runtime_proof.h"

#include <assert.h>
#include <pthread.h>
#include <stdint.h>

typedef struct {
    framer_runtime_key_probe key;
    framer_runtime_visibility visibility;
    uint32_t stop;
    uint32_t snapshots;
} concurrency_state;

static void *producer(void *opaque)
{
    concurrency_state *state = (concurrency_state *)opaque;
    uint32_t index;
    for (index = 1u; index <= 100000u; ++index) {
        uint32_t token = (index & 2u) != 0u ?
            FRAMER_RUNTIME_TOKEN_LEFT_SHIFT : FRAMER_RUNTIME_TOKEN_SPACE;
        framer_runtime_key_probe_observe(&state->key, token,
                                         (uint8_t)(index & 1u));
        framer_runtime_visibility_publish(&state->visibility, 19u, index);
    }
    __atomic_store_n(&state->stop, 1u, __ATOMIC_RELEASE);
    return (void *)0;
}

static void *observer(void *opaque)
{
    concurrency_state *state = (concurrency_state *)opaque;
    uint32_t generation;
    uint32_t revision;
    while (__atomic_load_n(&state->stop, __ATOMIC_ACQUIRE) == 0u) {
        framer_runtime_key_probe snapshot;
        if (framer_runtime_key_probe_try_read(&state->key, &snapshot)) {
            if (snapshot.observation_count != 0u)
                assert(snapshot.last_token == FRAMER_RUNTIME_TOKEN_SPACE ||
                       snapshot.last_token == FRAMER_RUNTIME_TOKEN_LEFT_SHIFT);
            assert(snapshot.last_level <= 1u);
            __atomic_add_fetch(&state->snapshots, 1u, __ATOMIC_RELAXED);
        }
        assert(framer_runtime_visibility_set(&state->visibility, 0));
        assert(framer_runtime_visibility_set(&state->visibility, 1));
        (void)framer_runtime_visibility_take_replay(
            &state->visibility, &generation, &revision);
    }
    return (void *)0;
}

int main(void)
{
    concurrency_state state = {0};
    pthread_t producer_thread;
    pthread_t observer_thread;
    framer_runtime_key_probe snapshot;
    framer_runtime_key_probe_init(&state.key);
    framer_runtime_visibility_init(&state.visibility);
    assert(pthread_create(&producer_thread, (const pthread_attr_t *)0,
                          producer, &state) == 0);
    assert(pthread_create(&observer_thread, (const pthread_attr_t *)0,
                          observer, &state) == 0);
    assert(pthread_join(producer_thread, (void **)0) == 0);
    assert(pthread_join(observer_thread, (void **)0) == 0);
    assert(framer_runtime_key_probe_try_read(&state.key, &snapshot));
    assert(snapshot.observation_count == 100000u);
    assert(framer_runtime_key_probe_commit(&state.key));
    assert(__atomic_load_n(&state.snapshots, __ATOMIC_ACQUIRE) != 0u);
    return 0;
}
