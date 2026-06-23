# Machine Reference — arn-lenovo
AMD Ryzen 7 6800HS · Arch Linux 7.0.12-arch1-1 · KDE Plasma 6.6.5 Wayland
Timezone: Europe/Rome (CEST, UTC+2) · NTP active
Last updated: 2026-06-23

---

## Hardware

| Component | Detail |
|-----------|--------|
| CPU | AMD Ryzen 7 6800HS (Rembrandt, Zen 3+, 8c/16t, Tjmax 95°C) |
| RAM | 16 GiB LPDDR5 6400 MT/s — 4×4 GiB quad-channel A/B/C/D (soldered, not upgradeable) |
| iGPU | AMD RDNA2 (Radeon 680M), primary display output |
| dGPU | Nvidia (hybrid mode via `envycontrol`, `nvidia-open-dkms 610.43.02-2`) |
| Storage | Samsung MZVL2512HCJQ-00BL2 NVMe 512 GB (`/dev/nvme0n1`) |
| Display | 3072×1920 @ 120 Hz eDP (internal), scale 1.65×, HDR incapable |
| WiFi | MediaTek MT7921 (`mt7921e` driver) |
| Form factor | Lenovo IdeaPad / LOQ — **NOT a ThinkPad** (no `/proc/acpi/ibm/fan`, fan is BIOS-only) |

---

## OS / Boot

- **Base**: EndeavourOS (Arch-based), rolling release
- **Kernel**: 7.0.12-arch1-1
- **Session**: Wayland (`XDG_SESSION_TYPE=wayland`)
- **Desktop**: KDE Plasma 6.6.5, KWin Wayland compositor
- **Machine ID**: `1bce9a9a72e844ed83a42ab47b2cb783`

### Bootloader — systemd-boot (BLS Type-1 entries)

Kernel-install + dracut layout. The cmdline lives in:
```
/efi/loader/entries/1bce9a9a72e844ed83a42ab47b2cb783-7.0.12-arch1-1.conf  →  options …
```
Sourced from `/etc/kernel/cmdline`.

**CRITICAL GOTCHA**: `sudo dracut --force` rebuilds the initrd image only — it does **not** update the `options` line in the boot entry. Always run `sudo reinstall-kernels` after editing `/etc/kernel/cmdline`, or changes silently won't apply until you do.

### Current cmdline (`/etc/kernel/cmdline`)
```
nvme_load=YES nowatchdog rw
root=UUID=845bf044-bfc7-48a5-8573-f075dda8fc9b
resume=UUID=845bf044-bfc7-48a5-8573-f075dda8fc9b
resume_offset=19793920
amdgpu.dcdebugmask=0x200
amd_pmc_ips=1
```

- `resume=` + `resume_offset=19793920` — hibernate target: swapfile on root partition
- `amd_pmc_ips=1` — AMD Platform Management Controller Integrated Power Scheduler; improves SoC-level power coordination between CPU and firmware
- `amdgpu.dcdebugmask=0x200` — AMDGPU display core debug mask; present from original setup, stabilises display output on RDNA2 iGPU

### Partition layout

| Device | Role | UUID |
|--------|------|------|
| `/dev/nvme0n1p1` | EFI (`/efi`) | — |
| `/dev/nvme0n1p2` | ext4 root (`/`) | `845bf044-bfc7-48a5-8573-f075dda8fc9b` |
| `/dev/nvme0n1p3` | swap partition (8.8 GiB) | `850d45a4-b838-4596-b06d-c92b56f710f0` |
| `/swapfile` | swap file on root (8 GiB), offset `19793920` | — |

**Total swap: 16.8 GiB > 16 GiB RAM** — hibernate is safe even under heavy load.

If `/swapfile` is ever recreated, recompute the offset:
```bash
sudo filefrag -v /swapfile | awk 'NR==4{print $4}' | tr -d '.'
```
Then update `/etc/kernel/cmdline` and run `sudo reinstall-kernels`.

---

## CPU Power Management

- **Driver**: `amd-pstate-epp` — hardware-guided P-states with energy-performance preference hints
- **Governor**: `powersave`
- **EPP**: `balance_power` — hardware balances performance and efficiency within this hint
- **power-profiles-daemon**: active, current profile `balanced`

These work together: power-profiles-daemon sets EPP hints; the hardware decides actual frequencies. 95°C under load is Tjmax for this chip — normal, not a danger threshold.

**ryzenadj** (v0.19.0 installed): Can override STAPM/PPT/TDC power limits. Cannot read current limits without `ryzen_smu-dkms-git` (kernel blocks `/dev/mem`). Resets on reboot — not persistent without a systemd service. Conservative starting point: `sudo ryzenadj --stapm-limit=25000 --fast-limit=35000 --slow-limit=28000`. Not currently applied.

Thermal sensor: `/sys/class/hwmon/hwmon4/temp1_input` (k10temp driver, Tctl).

---

## Sleep / Hibernate

### Why hibernate instead of sleep

This machine has **no S3 deep sleep** — `cat /sys/power/mem_sleep` returns only `[s2idle]` (modern standby). Under s2idle the CPU keeps running at low power (~5–10 W). Fine at a desk; dangerous in a sealed bag. Confirmed incident: laptop in bag for one hour under s2idle → bag too hot to touch ("rovente").

**Decision**: lid close → Hibernate (suspend-to-disk). RAM is written to swap, laptop fully powers off (0 W). On open: boot splash briefly, then KDE resumes exactly where it was — same windows, unsaved state, cursor positions. Safe in bags.

### PowerDevil lid action

`~/.config/powerdevilrc`:
- `LidAction=2` (hibernate) set for **all three profiles**: AC, Battery, LowBattery
- Auto-suspend idle timeouts: AC → 7200 s (2 h), Battery → 1800 s (30 min), LowBattery → 600 s (10 min)

### Hibernate prerequisites (all active)

- `resume=UUID…` + `resume_offset=19793920` in `/proc/cmdline` ✓
- `resume` hook present in dracut initrd ✓
- Total swap (16.8 GiB) > RAM (16 GiB) ✓
- `nvidia-suspend.service`, `nvidia-hibernate.service`, `nvidia-resume.service` **enabled** ✓

### Nvidia + hibernate (critical)

In hybrid mode the Nvidia driver holds GPU memory allocations. Without the sleep services, the kernel tries to power the GPU down while it still has active mappings → `kgmmuInvalidateTlb_GM107: TLB invalidation failed` floods the journal every 4 s for ~50 s → system falls back to clean poweroff. 

Symptom of missing services: laptop powers off on lid close (looks right), but on next boot KDE session-restores apps from scratch (cold restart) instead of resuming true state. This is KDE's "restore previous session" feature, not hibernate resume.

Fix (applied): three nvidia sleep services enabled. `PreserveVideoMemoryAllocations` is already `2` by default in nvidia-open-dkms — no modprobe override needed.

### Temp-guard safety daemon

`/etc/systemd/system/temp-guard.service` → `/usr/local/bin/temp-guard`

Last-resort backstop independent of KDE/PowerDevil. Polls CPU temp every 30 s. Logic:
- Lid **open**: does nothing (CPU self-throttles at Tjmax)
- Lid **closed** + temp ≥ 70°C for 3 consecutive checks (3 min) → `systemctl hibernate`
- After 60 s, if still closed + hot → `systemctl poweroff`

Configurable via env vars: `TEMP_GUARD_THRESHOLD` (default 70), `TEMP_GUARD_SUSTAIN` (default 180 s), `TEMP_GUARD_INTERVAL` (default 30 s).

---

## GPU

### Configuration

- **Mode**: `hybrid` (`envycontrol --query` → `hybrid`). AMD iGPU drives the internal display and all desktop rendering; Nvidia dGPU available for offloaded compute/gaming.
- **Nvidia packages**: `nvidia-open-dkms 610.43.02-2` (open source kernel modules), `nvidia-utils`, `nvidia-settings`, `opencl-nvidia`

### AMD RADV tuning (`/etc/environment`)

```
RADV_PERFTEST=gpl       # graphics pipeline library — faster shader compilation
MESA_GLTHREAD=true      # offloads GL API calls to a dedicated thread
# KWIN_DRM_NO_DIRECT_SCANOUT=1   — disabled (was causing compositor issues)
```

Other env vars: `BROWSER=firefox`, `EDITOR=nano`

### Brightness fix

`nvidia_wmi_ec_backlight` resets to 241 on certain events (backlight change, resume). Fix:
- `/usr/local/bin/brightness-fix.sh` — if brightness == 241 → set to 800
- `/etc/udev/rules.d/90-brightness-fix.rules` — fires on `ACTION=="change", SUBSYSTEM=="backlight", KERNEL=="nvidia_wmi_ec_backlight"`

---

## System Configuration

### Filesystem (`/etc/fstab`)
- Root ext4 mounted with `noatime,commit=30` — reduces write amplification, delays journal commits
- `tune2fs -m 1 /dev/nvme0n1p2` — reserved blocks lowered 5% → 1% (~15 GiB freed)

### Kernel / sysctl (`/etc/sysctl.d/99-performance.conf`)
```
vm.swappiness = 10
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.dirty_expire_centisecs = 3000
vm.dirty_writeback_centisecs = 1500
kernel.sched_migration_cost_ns = 500000   # reduce cross-core task migration
kernel.sched_autogroup_enabled = 1
```

### WiFi

- `/etc/NetworkManager/conf.d/wifi-powersave.conf`: `wifi.powersave = 2` (NM power save off)
- `/etc/modprobe.d/mt7921.conf`: `options mt7921e fwlps=0` (firmware-level power save off)
- Reason: MT7921 power save causes latency spikes and intermittent disconnects

### Build toolchain (`/etc/makepkg.conf`)
- `CFLAGS="-march=znver3 -mtune=znver3 …"` — native Zen 3+ tuning
- `MAKEFLAGS="-j$(nproc)"` — parallel compilation
- ccache enabled, 5 GiB cache

### Services
- `ananicy-cpp` — process priority manager, enabled + running. Startup cgroup errors are harmless (root cgroup rejection on cgroup v2, self-corrects immediately).
- `plocate-updatedb` — delayed 120 s post-boot (`/etc/systemd/system/plocate-updatedb.service.d/delay.conf`)
- `amd-ucode` — installed and current (`20260519-1`)
- `power-profiles-daemon` — active, profile `balanced`
- `nvidia-suspend/hibernate/resume.service` — all enabled (required for Nvidia + hibernate)

---

## Fan Control

No fan control from userspace. `/proc/acpi/ibm/fan` does not exist — this is a Lenovo IdeaPad/LOQ, not a ThinkPad. `thinkfan` does not work here. Fan curves are BIOS-only (F2 at boot).

---

## Optional / Pending

- **VRR**: KDE System Settings → Display & Monitor → Variable Refresh Rate → Automatic. Panel support unconfirmed; kscreen-doctor cannot set VRR via CLI in the current KDE version.
- **iGPU VRAM in BIOS**: F2 at boot → set iGPU VRAM to 512 MB–1 GB. Low priority — quad-channel LPDDR5 6400 MT/s already gives the iGPU excellent bandwidth.
- **ryzenadj persistent**: If permanent power limit tuning is desired, wrap in a systemd oneshot service. Test values manually first.
- **ryzen_smu-dkms-git**: `yay -S ryzen_smu-dkms-git` — unlocks ryzenadj monitoring (read STAPM/PPT/TDC). DKMS, rebuilds on kernel update.

---

## Key Gotchas

1. **Cmdline changes**: Edit `/etc/kernel/cmdline` → `sudo reinstall-kernels`. Never use `dracut --force` alone — it silently leaves the old cmdline in the boot entry. Verify with `cat /proc/cmdline` after reboot.

2. **Hibernate + Nvidia hybrid**: Requires `nvidia-suspend/hibernate/resume.service` enabled. Without them, Nvidia driver crashes on hibernate, system falls back to poweroff, KDE session-restores apps cold on next boot. Services are now enabled.

3. **No S3 sleep**: Only s2idle available. Never rely on sleep in a bag — use hibernate. Lid action is set to hibernate on all three PowerDevil profiles (AC + Battery + LowBattery).

4. **No fan control from Linux**: IdeaPad/LOQ, not ThinkPad. BIOS only.

5. **Swapfile offset is fixed**: `/swapfile` must be at offset `19793920` from the start of `/dev/nvme0n1p2`. If the swapfile is ever deleted and recreated, offset changes — recompute with `filefrag` and update cmdline + `reinstall-kernels`.
