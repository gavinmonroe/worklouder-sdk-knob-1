/*
 * Stage 3B executable canary for the Framer F1.
 *
 * The stock Timer view calls the remaining-seconds getter through a function
 * pointer. The Stage 3B builder redirects only that pointer here. Returning a
 * constant 42 makes the existing numeric display render 00:42 without
 * mutating the Timer controller or calling LVGL from a new context.
 */

    .section .text.stage3b_visible_canary, "ax", @progbits
    .align 4
    .global stage3b_visible_canary
    .type stage3b_visible_canary, @function

stage3b_visible_canary:
    entry   a1, 32
    movi    a2, 42
    retw.n

    .size stage3b_visible_canary, . - stage3b_visible_canary
    .balign 4, 0
