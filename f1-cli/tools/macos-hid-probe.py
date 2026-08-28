#!/usr/bin/env python3
"""Diagnose why macOS refuses HID output reports to the Work Louder Knob 1.

Read-only: opens the device and sends the audited `sys.version` RPC only.
Run plain, then under sudo, and compare the IOReturn codes.
"""
import ctypes, ctypes.util, os, re, subprocess, sys

IOKit = ctypes.CDLL(ctypes.util.find_library("IOKit"))

IOKit.IORegistryEntryIDMatching.restype  = ctypes.c_void_p
IOKit.IORegistryEntryIDMatching.argtypes = [ctypes.c_uint64]
IOKit.IOServiceGetMatchingService.restype  = ctypes.c_uint32
IOKit.IOServiceGetMatchingService.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
IOKit.IOHIDDeviceCreate.restype  = ctypes.c_void_p
IOKit.IOHIDDeviceCreate.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
IOKit.IOHIDDeviceOpen.restype   = ctypes.c_int32
IOKit.IOHIDDeviceOpen.argtypes  = [ctypes.c_void_p, ctypes.c_uint32]
IOKit.IOHIDDeviceClose.restype  = ctypes.c_int32
IOKit.IOHIDDeviceClose.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
IOKit.IOHIDDeviceSetReport.restype  = ctypes.c_int32
IOKit.IOHIDDeviceSetReport.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_long,
                                       ctypes.POINTER(ctypes.c_uint8), ctypes.c_long]

IORETURN = {
    0x00000000: "kIOReturnSuccess",     0xe00002bc: "kIOReturnError",
    0xe00002c0: "kIOReturnNoDevice",    0xe00002c1: "kIOReturnNotPrivileged",
    0xe00002c2: "kIOReturnBadArgument", 0xe00002c5: "kIOReturnExclusiveAccess",
    0xe00002c7: "kIOReturnUnsupported", 0xe00002cd: "kIOReturnNotOpen",
    0xe00002cf: "kIOReturnNotWritable", 0xe00002d5: "kIOReturnBusy",
    0xe00002d6: "kIOReturnTimeout",     0xe00002e2: "kIOReturnNotPermitted",
}
name = lambda r: IORETURN.get(r & 0xffffffff, "unrecognised")

SEIZE = 1  # kIOHIDOptionsTypeSeizeDevice

def find_entry_id():
    if len(sys.argv) > 1:
        return int(sys.argv[1], 16)
    out = subprocess.run(["hidutil", "list"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "0x8296" in line and "AppleUserHIDDevice" in line:
            m = re.search(r"(0x[0-9a-f]+)\s+USB", line)
            if m:
                return int(m.group(1), 16)
    sys.exit("Could not locate the Knob 1 (PID 0x8296) in `hidutil list`.")

def rpc_payload():
    buf = (ctypes.c_uint8 * 63)()
    msg = b'{"jsonrpc":"2.0","method":"sys.version","id":1}\n'
    buf[0] = 2              # CHANNEL_RPC
    buf[1] = len(msg)       # chunk size
    for i, b in enumerate(msg):
        buf[2 + i] = b
    return buf

print(f"uid={os.getuid()}  euid={os.geteuid()}")
entry_id = find_entry_id()
print(f"registry entry id     = 0x{entry_id:x}")

service = IOKit.IOServiceGetMatchingService(0, IOKit.IORegistryEntryIDMatching(entry_id))
if not service:
    sys.exit("Could not resolve that registry entry.")
dev = IOKit.IOHIDDeviceCreate(None, service)
if not dev:
    sys.exit("IOHIDDeviceCreate returned NULL.")

for label, opts in (("open(0)", 0), ("open(SeizeDevice)", SEIZE)):
    r = IOKit.IOHIDDeviceOpen(dev, opts) & 0xffffffff
    print(f"\n{label:20} -> 0x{r:08x}  {name(r)}")
    if r != 0:
        continue
    for rtype, tname in ((1, "Output"), (2, "Feature")):
        rr = IOKit.IOHIDDeviceSetReport(dev, rtype, 6, rpc_payload(), 63) & 0xffffffff
        verdict = "  <<< WRITE SUCCEEDED" if rr == 0 else ""
        print(f"  SetReport({tname:7}, id=6) -> 0x{rr:08x}  {name(rr)}{verdict}")
    IOKit.IOHIDDeviceClose(dev, opts)
