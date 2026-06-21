# Laptop Tuning Tracker
AMD Ryzen 7 6800HS · Arch Linux 7.0.12 · KDE Plasma Wayland
Last updated: 2026-06-21

## Batch A — Bootloader ✅ REBOOT REQUIRED
- [x] A1 — `amd_pmc_ips=1` added to `/etc/kernel/cmdline` → UKI regenerated (dracut --force)
- [x] A2 — 8 GiB swapfile at `/swapfile`, `resume_offset=19793920`, hibernate target changed to root partition + offset; fstab updated; UKI regenerated

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
- [ ] C3 — `ananicy-cpp` (AUR) — needs `yay` or `paru`: `yay -S ananicy-cpp && sudo systemctl enable --now ananicy-cpp`
- [ ] C4 — `thinkfan` (AUR) — needs `yay`: `yay -S thinkfan` then configure `/etc/thinkfan.conf`

## Batch D — Environment / GPU ✅
- [x] D1 — `/etc/environment`: `RADV_PERFTEST=gpl`, `MESA_GLTHREAD=true` added
- [x] D2 — `/etc/environment`: `KWIN_DRM_NO_DIRECT_SCANOUT=1` commented out (takes effect on next login)
- [ ] D3 — VRR: test in KDE Display Settings → "Variable Refresh Rate" (manual; panel support unknown)

## Batch E — Advanced (post-reboot)
- [ ] E1 — RyzenAdj undervolting: `yay -S ryzenadj`, then test with `sudo ryzenadj --stapm-limit=25000 --ppt-limit=45000`; start conservative
- [ ] E2 — BIOS: set iGPU VRAM to 512 MB–1 GiB (manual, F2 at boot)
- [ ] E3 — BIOS: check/update EC firmware via Lenovo Vantage or `fwupdmgr update` (check `fwupdmgr get-updates`)

## Batch F — Manual ✅
- [ ] F1 — Check RAM dual-channel: `sudo dmidecode -t memory | grep -E 'Size|Speed|Locator'`
- [x] F2 — plocate-updatedb: delayed 2 min post-boot (saves ~5.7s from boot path)
- [ ] F3 — After reboot: confirm lid-close → Hibernate works (close lid, reopen, check session restored)

## Reboot checklist
After next reboot, verify:
1. `cat /proc/cmdline` contains `amd_pmc_ips=1` and `resume_offset=19793920`
2. `swapon --show` shows both `/dev/nvme0n1p3` and `/swapfile`
3. KDE compositor works without KWIN_DRM_NO_DIRECT_SCANOUT (no tearing/artifacts)
4. WiFi power save: `iw dev wlan0 get power_save` → should say "off"
5. Test hibernate: close lid → should fully power off → open → session restores
6. `iw dev wlan0 get power_save` shows "Power save: off"

## AUR items still pending (need yay/paru)
- `yay -S ananicy-cpp` → `sudo systemctl enable --now ananicy-cpp`
- `yay -S thinkfan` → configure `/etc/thinkfan.conf`
- `yay -S ryzenadj` → careful testing with load

## Notes
- Swapfile hibernation target: `/swapfile` on `/dev/nvme0n1p2` (root), offset 19793920
- Total swap after reboot: 8.8 GiB partition + 8 GiB file = 16.8 GiB > 13 GiB RAM ✓
- THP not changed to `madvise` (requires kernel param `transparent_hugepage=madvise` at boot or sysfs — add to next kernel cmdline edit if desired)
