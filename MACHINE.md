# Machine Reference — arn-lenovo
AMD Ryzen 7 6800HS · Arch Linux 7.0.12-arch1-1 · KDE Plasma Wayland
Last updated: 2026-06-23

---

## Hardware

| Component | Detail |
|-----------|--------|
| CPU | AMD Ryzen 7 6800HS (Rembrandt, Zen 3+, 8c/16t, Tjmax 95°C) |
| RAM | 16 GiB LPDDR5 6400 MT/s — 4×4 GiB across channels A/B/C/D (quad-channel, soldered) |
| GPU | AMD RDNA2 iGPU (primary display) + Nvidia dGPU (hybrid mode via envycontrol) |
| Storage | Samsung MZVL2512HCJQ-00BL2 NVMe 512 GB |
| Display | 3072×1920 @ 120 Hz eDP panel |
| WiFi | MediaTek MT7921 (mt7921e driver) |
| Form | Lenovo IdeaPad / LOQ — NOT a ThinkPad (no `/proc/acpi/ibm/fan`, fan is BIOS-only) |

---

## OS / Boot

- **Bootloader**: systemd-boot with BLS Type-1 entries (kernel-install + dracut)
  - Cmdline lives in `/efi/loader/entries/<machine-id>-<version>.conf` → `options` line
  - Sourced from `/etc/kernel/cmdline`
  - **GOTCHA**: `dracut --force` rebuilds initrd only — does NOT update cmdline. Always run `sudo reinstall-kernels` after editing `/etc/kernel/cmdline`.
- **Current cmdline** (`/etc/kernel/cmdline`):
  ```
  nvme_load=YES nowatchdog rw root=UUID=845bf044-bfc7-48a5-8573-f075dda8fc9b
  resume=UUID=845bf044-bfc7-48a5-8573-f075dda8fc9b resume_offset=19793920
  amdgpu.dcdebugmask=0x200 amd_pmc_ips=1
  ```
- **Partitions**:
  - `/dev/nvme0n1p1` — EFI (`/efi`)
  - `/dev/nvme0n1p2` — ext4 root (`/`), UUID `845bf044-bfc7-48a5-8573-f075dda8fc9b`
  - `/dev/nvme0n1p3` — swap partition, 8.8 GiB (UUID `850d45a4-b838-4596-b06d-c92b56f710f0`)
  - `/swapfile` — swap file on root, 8 GiB, offset `19793920`
- **Total swap**: 16.8 GiB > 16 GiB RAM → hibernation is safe even under heavy load

---

## Sleep / Hibernate

This machine has **no S3 deep sleep** — only `s2idle` (modern standby). Under s2idle the CPU keeps running at low power, which is fine at a desk but dangerous in a sealed bag (caused a "rovente" incident — bag too hot to touch after an hour).

**Decision**: Use Hibernate (suspend-to-disk) for lid close. Lid opens → session restores exactly as left. Lid closed → RAM written to swap → full power off (0 W). Safe in bags.

**KDE lid action**: Set to Hibernate in PowerDevil (`~/.config/powerdevilrc` → `LidAction=2`).

**Hibernate prerequisites** (all active):
- `resume=` + `resume_offset=` in cmdline ✓
- `resume` hook in initramfs (dracut) ✓
- Swap large enough (16.8 GiB > RAM) ✓
- `nvidia-suspend.service`, `nvidia-hibernate.service`, `nvidia-resume.service` **enabled** ✓

**Nvidia + hibernate** (critical): In hybrid mode, the Nvidia driver must save GPU state before the RAM image is written. Without the nvidia sleep services, the driver crashes with `kgmmuInvalidateTlb` errors for ~50 s then falls back to a clean poweroff. KDE then restores the session list from scratch (looks like hibernate but apps restart cold). Fix: enable the three nvidia sleep services (done). `PreserveVideoMemoryAllocations` is already 2 (enabled by default in nvidia-open-dkms).

**Temp-guard service** (`/etc/systemd/system/temp-guard.service`, `/usr/local/bin/temp-guard`): A safety net daemon. Monitors CPU temperature when the lid is closed. If temperature stays ≥ 70°C for 3 min with lid closed → `systemctl hibernate` (then poweroff backstop after 60 s). Does nothing when lid is open (CPU self-throttles at 95°C Tjmax, normal). This is a last-resort guard, not the primary sleep mechanism.

---

## GPU

- **Mode**: `hybrid` (envycontrol). AMD iGPU drives the display; Nvidia dGPU available for offloaded workloads.
- **Nvidia packages**: `nvidia-open-dkms 610.43.02-2`, `nvidia-utils`, `nvidia-settings`, `opencl-nvidia`
- **AMD RADV tuning** (`/etc/environment`):
  - `RADV_PERFTEST=gpl` — enables graphics pipeline library (faster shader compilation)
  - `MESA_GLTHREAD=true` — offloads GL API calls to a second thread
  - `KWIN_DRM_NO_DIRECT_SCANOUT=1` — commented out (was causing issues; disabled)
- **Brightness fix**: `nvidia_wmi_ec_backlight` tends to reset to 241 on events. `/usr/local/bin/brightness-fix.sh` + `/etc/udev/rules.d/90-brightness-fix.rules` catches backlight change events and restores to 800.

---

## System Configuration

### Kernel / sysctl (`/etc/sysctl.d/99-performance.conf`)
```
vm.swappiness = 10                    # swap only under real pressure
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.dirty_expire_centisecs = 3000
vm.dirty_writeback_centisecs = 1500
kernel.sched_migration_cost_ns = 500000
kernel.sched_autogroup_enabled = 1
```

### Filesystem (`/etc/fstab`)
- Root ext4 mounted with `noatime,commit=30` — reduces write amplification
- `tune2fs -m 1 /dev/nvme0n1p2` — reserved blocks lowered from 5% → 1% (~15 GiB recovered)

### WiFi power management
- `/etc/NetworkManager/conf.d/wifi-powersave.conf`: `wifi.powersave = 2` (disabled)
- `/etc/modprobe.d/mt7921.conf`: `options mt7921e fwlps=0` (firmware-level power save off)
- Reason: WiFi power save causes latency spikes and occasional drops on this card

### Build optimisation (`/etc/makepkg.conf`)
- `CFLAGS="-march=znver3 -mtune=znver3 ..."` — native Zen 3+ tuning
- `MAKEFLAGS="-j$(nproc)"` — parallel builds
- ccache enabled, 5 GiB cache

### Services
- `ananicy-cpp` — process priority manager, running (enabled). Startup cgroup errors are harmless; it creates sub-cgroups after the initial root-cgroup rejection.
- `plocate-updatedb` delayed 2 min post-boot (`/etc/systemd/system/plocate-updatedb.service.d/delay.conf`)
- `amd-ucode` — installed and current (20260519-1)

### CPU power (ryzenadj)
- `ryzenadj` v0.19.0 installed. Can SET power limits but cannot READ them (kernel blocks `/dev/mem` access without `ryzen_smu-dkms-git`).
- Conservative starting point: `sudo ryzenadj --stapm-limit=25000 --fast-limit=35000 --slow-limit=28000`
- **Not applied by default** — resets on reboot, requires manual testing.

---

## Thermal sensor

CPU temp readable at `/sys/class/hwmon/hwmon4/temp1_input` (k10temp driver, Tctl). Tjmax is 95°C — this is normal operating temperature for Ryzen 6000 under load, not a danger threshold.

---

## Optional / Pending

- **VRR**: KDE System Settings → Display & Monitor → Variable Refresh Rate → Automatic. Panel support unconfirmed; cannot set via CLI in current KDE version.
- **iGPU VRAM in BIOS**: F2 at boot → set iGPU VRAM to 512 MB–1 GB. Low priority — quad-channel LPDDR5 6400 MT/s already provides excellent iGPU bandwidth.
- **ryzenadj persistent tuning**: If power limits are desired permanently, create a systemd service that runs ryzenadj on boot. Test values first manually.
- **ryzen_smu-dkms-git**: `yay -S ryzen_smu-dkms-git` — enables ryzenadj monitoring (read current limits). AUR, DKMS build required.

---

## Key Gotchas

1. **Cmdline changes**: Edit `/etc/kernel/cmdline` then `sudo reinstall-kernels`. Do NOT use `dracut --force` alone — it silently leaves the old cmdline in the boot entry.
2. **Hibernate + Nvidia**: Requires `nvidia-suspend/hibernate/resume.service` enabled. Without them, Nvidia crashes during hibernate and the system falls back to poweroff. Symptom: apps "restore" but restart from scratch (KDE session restore, not true hibernate resume).
3. **No S3 sleep**: This machine only supports s2idle. Never rely on sleep in a bag — use hibernate (lid action is already set).
4. **Fan control**: No thinkpad_acpi interface. Fan is fully BIOS-controlled; thinkfan does not work on this machine.
5. **Swap for hibernate**: The swapfile offset must match `resume_offset` in cmdline. Current offset `19793920` was obtained via `filefrag -v /swapfile`. If the swapfile is ever recreated, recompute and update cmdline.
