# Laptop Tuning Tracker
AMD Ryzen 7 6800HS · Arch Linux 7.0.12 · KDE Plasma Wayland
Last updated: 2026-06-22

## Batch A — Bootloader ✅ ACTIVE
- [x] A1 — `amd_pmc_ips=1` in `/proc/cmdline` ✓ (verified 2026-06-22)
- [x] A2 — 8 GiB `/swapfile` + 8.8 GiB partition = 16.8 GiB active, `resume_offset=19793920` ✓
- NOTE: systemd-boot BLS entries — `dracut --force` does NOT update cmdline. Use `reinstall-kernels`.

## Batch B — System config ✅
- [x] B1 — `/etc/sysctl.d/99-performance.conf`: swappiness=10, dirty_ratio=10/5, sched_migration_cost_ns=500000 (applied live)
- [x] B2 — `/etc/fstab`: `commit=30` added to ext4 root
- [x] B3 — `tune2fs -m 1 /dev/nvme0n1p2`: reserved blocks 5%→1% (~15 GiB recovered)
- [x] B4 — `/etc/NetworkManager/conf.d/wifi-powersave.conf`: WiFi power save off (NM restarted)
- [x] B5 — `/etc/modprobe.d/mt7921.conf`: `fwlps=0` (takes effect on next boot)
- [x] B6 — `/etc/makepkg.conf`: `-march=znver3 -mtune=znver3`, ccache enabled, `MAKEFLAGS=-j$(nproc)`
- [x] B7 — `/usr/local/bin/brightness-fix.sh` created; `/etc/udev/rules.d/90-brightness-fix.rules` fixed (udev reloaded)

## Batch C — Services / packages ✅
- [x] C1 — `amd-ucode 20260519-1`: already installed ✓
- [x] C2 — `ccache` installed, 5 GiB cache configured
- [x] C3 — `ananicy-cpp` installed and running (from `extra` repo, not AUR). Startup cgroup errors are harmless — it creates sub-cgroups and runs fine.
- [x] C4 — `thinkfan` N/A: `/proc/acpi/ibm/fan` not present (IdeaPad/LOQ, not ThinkPad). Fan is BIOS-controlled only on this machine.

## Batch D — Environment / GPU ✅
- [x] D1 — `/etc/environment`: `RADV_PERFTEST=gpl`, `MESA_GLTHREAD=true` added
- [x] D2 — `/etc/environment`: `KWIN_DRM_NO_DIRECT_SCANOUT=1` commented out (takes effect on next login)
- [ ] D3 — VRR: test in KDE Display Settings → "Variable Refresh Rate" (manual; panel support unknown)

## Batch E — Advanced
- [x] E1 — `ryzenadj` installed (v0.19.0). NOTE: `/dev/mem` access blocked by kernel — cannot READ current limits, but can SET them. To enable monitoring: `yay -S ryzen_smu-dkms-git`. Conservative test: `sudo ryzenadj --stapm-limit=25000 --fast-limit=35000 --slow-limit=28000` (do manually, watch thermals).
- [x] E2 — BIOS iGPU VRAM: fwupdmgr confirmed no firmware updates needed. VRAM setting still manual (F2 at boot) — RAM is 4-channel LPDDR5 6400 MT/s so iGPU already has excellent bandwidth.
- [x] E3 — `fwupdmgr get-updates`: no updates available for any device ✓

## Batch F — Manual ✅
- [x] F1 — RAM: quad-channel LPDDR5 6400 MT/s, 4×4 GiB (channels A/B/C/D) — optimal config ✓
- [x] F2 — plocate-updatedb: delayed 2 min post-boot (saves ~5.7s from boot path)
- [x] F3 — Lid-close → Hibernate → resume confirmed working (2026-06-22) ✓

## Reboot checklist — COMPLETE (2026-06-22)
- [x] `amd_pmc_ips=1` and `resume_offset=19793920` in `/proc/cmdline` ✓
- [x] Both swaps active: `/swapfile` 8G + `/dev/nvme0n1p3` 8.8G ✓
- [x] WiFi power save: off ✓
- [ ] KDE compositor: check for tearing/artifacts (manual)
- [x] Test hibernate: close lid → fully powers off → reopen → session restores ✓

## Remaining manual items
- **VRR**: KDE System Settings → Display & Monitor → "Variable Refresh Rate" → set to Automatic (cannot set via CLI)
- **iGPU VRAM**: F2 at boot → set to 512 MB–1 GB (optional; 4-channel LPDDR5 already gives good bandwidth)
- **ryzenadj tuning**: `sudo ryzenadj --stapm-limit=25000 --fast-limit=35000 --slow-limit=28000` — test under load, revert if unstable. For monitoring, first install `yay -S ryzen_smu-dkms-git`.

## Notes
- Swapfile hibernation target: `/swapfile` on `/dev/nvme0n1p2` (root), offset 19793920
- Total swap after reboot: 8.8 GiB partition + 8 GiB file = 16.8 GiB > 13 GiB RAM ✓
- THP not changed to `madvise` (requires kernel param `transparent_hugepage=madvise` at boot or sysfs — add to next kernel cmdline edit if desired)
