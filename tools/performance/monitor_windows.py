"""Sample NVIDIA whole-adapter counters and owned benchmark process memory/CPU.

Working sets include shared pages; PrivateUsage is private commit, not resident RAM.
No process is modified. Only PIDs supplied by the benchmark are inspected.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
from pathlib import Path
import subprocess
import time

class MemoryCounters(C.Structure):
    _fields_ = [('cb', W.DWORD), ('PageFaultCount', W.DWORD)] + [(name, C.c_size_t) for name in (
        'PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage',
        'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]

kernel = C.WinDLL('kernel32', use_last_error=True)
psapi = C.WinDLL('psapi', use_last_error=True)
kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
kernel.OpenProcess.restype = W.HANDLE
kernel.CloseHandle.argtypes = [W.HANDLE]
kernel.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(W.FILETIME)] * 4
psapi.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(MemoryCounters), W.DWORD]

class ProcessEntry(C.Structure):
    _fields_ = [('dwSize', W.DWORD), ('cntUsage', W.DWORD), ('th32ProcessID', W.DWORD),
                ('th32DefaultHeapID', C.c_size_t), ('th32ModuleID', W.DWORD), ('cntThreads', W.DWORD),
                ('th32ParentProcessID', W.DWORD), ('pcPriClassBase', W.LONG), ('dwFlags', W.DWORD),
                ('szExeFile', W.WCHAR * 260)]

kernel.CreateToolhelp32Snapshot.argtypes = [W.DWORD,W.DWORD]
kernel.CreateToolhelp32Snapshot.restype = W.HANDLE
kernel.Process32FirstW.argtypes = [W.HANDLE,C.POINTER(ProcessEntry)]
kernel.Process32NextW.argtypes = [W.HANDLE,C.POINTER(ProcessEntry)]

def descendants(root_pid):
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == C.c_void_p(-1).value:
        return [root_pid]
    parents = {}
    entry = ProcessEntry()
    entry.dwSize = C.sizeof(entry)
    try:
        ok = kernel.Process32FirstW(snapshot, C.byref(entry))
        while ok:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            ok = kernel.Process32NextW(snapshot, C.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    owned = {root_pid}
    while True:
        new = {pid for pid, parent in parents.items() if parent in owned}
        if new <= owned:
            return sorted(owned)
        owned.update(new)

def process_sample(pids):
    rows = []
    for pid in set(pids):
        handle = kernel.OpenProcess(0x0400 | 0x0010, False, int(pid))
        if not handle:
            continue
        try:
            memory = MemoryCounters()
            memory.cb = C.sizeof(memory)
            times = [W.FILETIME() for _ in range(4)]
            if psapi.GetProcessMemoryInfo(handle, C.byref(memory), memory.cb) and kernel.GetProcessTimes(handle, *[C.byref(v) for v in times]):
                cpu = sum((v.dwHighDateTime << 32) + v.dwLowDateTime for v in times[2:]) / 1e7
                rows.append({'pid': int(pid), 'working_set_bytes': memory.WorkingSetSize,
                             'private_commit_bytes': memory.PrivateUsage, 'cpu_seconds': cpu})
        finally:
            kernel.CloseHandle(handle)
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = ['nvidia-smi', '--query-gpu=timestamp,index,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,utilization.decoder',
               '--format=csv,noheader,nounits', '--loop-ms=1000']
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        with args.output.open('a', encoding='utf-8', buffering=1) as output:
            for line in child.stdout:
                fields = [v.strip() for v in line.split(',')]
                if len(fields) != 9:
                    continue
                try:
                    target = json.loads(args.targets.read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    target = {}
                def number(value):
                    try: return float(value)
                    except ValueError: return None
                row = dict(zip(['vendor_timestamp', 'gpu_index', 'gpu_util_pct', 'gpu_memory_controller_pct',
                                'gpu_memory_mib', 'gpu_total_mib', 'gpu_temp_c', 'gpu_power_w', 'gpu_decoder_pct'],
                               [fields[0]] + [number(v) for v in fields[1:]]))
                row.update(at=time.time(), case=target.get('case'), phase=target.get('phase'),
                           browser=process_sample(descendants(target['browser_root_pid']) if target.get('browser_root_pid') else target.get('browser_pids', [])),
                           server=process_sample(target.get('server_pids', [])))
                output.write(json.dumps(row) + '\n')
    finally:
        child.terminate()
        child.wait(timeout=10)

if __name__ == '__main__':
    main()
