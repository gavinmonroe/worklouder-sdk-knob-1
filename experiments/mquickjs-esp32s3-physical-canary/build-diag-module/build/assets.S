.section .rodata.physical_assets,"a",@progbits
.balign 16
.global framer_physical_weather_f2js_start
framer_physical_weather_f2js_start:
.incbin "/Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/experiments/mquickjs-esp32s3-physical-canary/build-diag-module/assets/weather-id28-gen19.f2js"
.global framer_physical_weather_f2js_end
framer_physical_weather_f2js_end:
.balign 16
.global framer_physical_weather_f2tf_start
framer_physical_weather_f2tf_start:
.incbin "/Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/experiments/mquickjs-esp32s3-physical-canary/build-diag-module/assets/weather-id28-gen19.f2tf"
.global framer_physical_weather_f2tf_end
framer_physical_weather_f2tf_end:
.balign 16
.global framer_physical_weather_base_lzss_start
framer_physical_weather_base_lzss_start:
.incbin "/Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/experiments/mquickjs-esp32s3-physical-canary/build-diag-module/assets/weather-id28-base.lzss"
.global framer_physical_weather_base_lzss_end
framer_physical_weather_base_lzss_end:
.balign 16
.global framer_physical_weather_f2js_sha256
framer_physical_weather_f2js_sha256:
.incbin "/Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/experiments/mquickjs-esp32s3-physical-canary/build-diag-module/assets/weather-id28-f2js.sha256.bin"
.balign 16
.global framer_physical_target_contract_sha256
framer_physical_target_contract_sha256:
.incbin "/Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/experiments/mquickjs-esp32s3-physical-canary/build-diag-module/assets/target-contract.sha256.bin"
