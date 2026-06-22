#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests>=2.31"]
# ///
"""watch — capture a transcript from a local media file, a YouTube link, or any
yt-dlp-supported URL, and autosave it (transcript + frontmatter) to the scope's
sources/ layer (MEM-14).

Routing (cheapest path first):
  local file        -> ffmpeg extract/downsample -> Groq Whisper
  YouTube/other URL -> yt-dlp captions (free) -> Supadata fallback -> yt-dlp audio -> Groq

Cross-brain shared skill: both Claude Code and Hermes invoke it as
  uv run ~/.cockpit/skills/watch/watch.py <input> [--visual] [--scope S] [--no-save]
Keys (GROQ_API_KEY, SUPADATA_API_KEY) are read from ~/.cockpit/.env (gitignored).
"""
import argparse, os, re, sys, json, subprocess, tempfile, shutil, datetime, glob

UA = "Mozilla/5.0 (X11; Linux x86_64) cockpit-watch/1.0"  # Groq/Supadata sit behind Cloudflare; default urllib UA is 403'd
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
SUPADATA_URL = "https://api.supadata.ai/v1/transcript"
COCKPIT = os.path.expanduser("~/.cockpit")
GROQ_MAX_BYTES = 24 * 1024 * 1024  # stay under Groq's 25 MB upload cap


def log(*a): print("[watch]", *a, file=sys.stderr)


def load_env():
    p = os.path.join(COCKPIT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v.strip())


def yt(*args):
    """Run yt-dlp, preferring an installed binary, falling back to ephemeral uvx."""
    base = ["yt-dlp"] if shutil.which("yt-dlp") else ["uvx", "yt-dlp"]
    return subprocess.run(base + list(args), capture_output=True, text=True)


def is_url(s):
    return s.startswith("http://") or s.startswith("https://")


def title_of(src, is_url_):
    if is_url_:
        r = yt("--no-warnings", "--print", "%(title)s", src)
        t = (r.stdout or "").strip().splitlines()
        if t and t[0]:
            return t[0]
        return "untitled"
    return os.path.splitext(os.path.basename(src))[0]


def slugify(s):
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return (s or "untitled")[:60]


# ---------- transcript sources ----------
def parse_vtt(text):
    out, seen = [], None
    for line in text.splitlines():
        line = line.strip()
        if (not line or line == "WEBVTT" or "-->" in line or line.isdigit()
                or line.startswith(("Kind:", "Language:", "NOTE"))):
            continue
        line = re.sub(r"<[^>]+>", "", line)  # strip inline timing tags
        if line and line != seen:
            out.append(line)
            seen = line
    return " ".join(out).strip()


def captions_via_ytdlp(url, tmp):
    """Free path: pull manual or auto subtitles, no audio download."""
    yt("--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs",
       "--sub-langs", "en.*,it.*", "--sub-format", "vtt",
       "-o", os.path.join(tmp, "cap.%(ext)s"), url)
    vtts = glob.glob(os.path.join(tmp, "*.vtt"))
    if not vtts:
        return None
    text = parse_vtt(open(vtts[0], encoding="utf-8", errors="ignore").read())
    return text or None


def supadata(url):
    key = os.environ.get("SUPADATA_API_KEY", "").strip()
    if not key:
        return None
    import requests
    try:
        r = requests.get(SUPADATA_URL, params={"url": url, "text": "true"},
                         headers={"x-api-key": key, "User-Agent": UA}, timeout=90)
        if r.status_code != 200:
            log("supadata HTTP", r.status_code)
            return None
        j = r.json()
        return (j.get("content") or j.get("transcript") or "").strip() or None
    except Exception as e:
        log("supadata error:", e)
        return None


# ---------- audio -> Groq ----------
def to_audio(src, tmp):
    """Downsample any media to 16 kHz mono opus (small, Whisper-native rate)."""
    out = os.path.join(tmp, "audio.opus")
    r = subprocess.run(["ffmpeg", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
                        "-c:a", "libopus", "-b:a", "20k", out],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError("ffmpeg audio extraction failed:\n" + r.stderr[-800:])
    return out


def chunk_audio(audio, tmp):
    """If over Groq's cap, split into time segments (re-encode-free copy)."""
    if os.path.getsize(audio) <= GROQ_MAX_BYTES:
        return [audio]
    pat = os.path.join(tmp, "chunk-%03d.opus")
    subprocess.run(["ffmpeg", "-y", "-i", audio, "-f", "segment",
                    "-segment_time", "1200", "-c", "copy", pat],
                   capture_output=True, text=True)
    return sorted(glob.glob(os.path.join(tmp, "chunk-*.opus"))) or [audio]


def groq_transcribe(audio, tmp):
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GROQ_API_KEY not set in ~/.cockpit/.env — cannot transcribe audio")
    import requests
    parts = []
    for piece in chunk_audio(audio, tmp):
        with open(piece, "rb") as f:
            r = requests.post(GROQ_URL,
                              headers={"Authorization": f"Bearer {key}", "User-Agent": UA},
                              files={"file": (os.path.basename(piece), f)},
                              data={"model": GROQ_MODEL, "response_format": "json"},
                              timeout=600)
        if r.status_code != 200:
            raise RuntimeError(f"Groq HTTP {r.status_code}: {r.text[:300]}")
        parts.append(r.json().get("text", "").strip())
    return "\n".join(p for p in parts if p).strip()


def visual_frames(src, slug, tmp, is_url_):
    """Optional: extract scene-change keyframes for visual context."""
    media = src
    if is_url_:
        out = os.path.join(tmp, "video.mp4")
        yt("--no-warnings", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", out, src)
        if not os.path.exists(out):
            log("--visual: video download failed; skipping frames")
            return None
        media = out
    fdir = os.path.join(COCKPIT, "memory", "scopes", ARGS_SCOPE, "sources", "assets", slug)
    os.makedirs(fdir, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-i", media, "-vf", "select=gt(scene\\,0.4)",
                    "-vsync", "vfr", os.path.join(fdir, "frame-%03d.jpg")],
                   capture_output=True, text=True)
    n = len(glob.glob(os.path.join(fdir, "frame-*.jpg")))
    return fdir if n else None


# ---------- save ----------
def save_source(text, meta):
    sdir = os.path.join(COCKPIT, "memory", "scopes", meta["scope"], "sources")
    os.makedirs(sdir, exist_ok=True)
    path = os.path.join(sdir, f"{meta['date']}-{meta['slug']}.md")
    fm = [
        "---", "type: transcript", f"title: {meta['title']!r}",
        f"source: {meta['source']}", f"source_type: {meta['source_type']}",
        f"captured: {meta['captured']}", f"session_anchor: {meta['anchor']}",
        f"scope: {meta['scope']}", "status: captured", f"method: {meta['method']}",
    ]
    if meta.get("frames"):
        fm.append(f"frames: {meta['frames']}")
    fm += ["distilled_into: []", "concepts: []", "people: []", "products: []",
           "schema_version: 1", "---", "", text, ""]
    open(path, "w", encoding="utf-8").write("\n".join(fm))
    return path


ARGS_SCOPE = "cockpit"


def main():
    global ARGS_SCOPE
    ap = argparse.ArgumentParser(prog="watch")
    ap.add_argument("input", help="local media path, YouTube link, or yt-dlp URL")
    ap.add_argument("--scope", default="cockpit", help="memory scope (default: cockpit)")
    ap.add_argument("--visual", action="store_true", help="also extract scene-change frames")
    ap.add_argument("--no-save", action="store_true", help="print transcript, do not autosave")
    ap.add_argument("--model", default=GROQ_MODEL, help="Groq whisper model")
    a = ap.parse_args()
    ARGS_SCOPE = a.scope
    load_env()

    src, urly = a.input, is_url(a.input)
    if not urly and not os.path.exists(src):
        sys.exit(f"[watch] not a URL and not an existing file: {src}")

    title = title_of(src, urly)
    slug = slugify(title)
    method, text = None, None

    with tempfile.TemporaryDirectory() as tmp:
        if urly:
            text = captions_via_ytdlp(src, tmp)
            if text:
                method = "captions"
            else:
                text = supadata(src)
                if text:
                    method = "supadata"
            if not text:
                log("no captions; downloading audio for Groq…")
                r = yt("--no-warnings", "-x", "--audio-format", "opus",
                       "-o", os.path.join(tmp, "dl.%(ext)s"), src)
                got = glob.glob(os.path.join(tmp, "dl.*"))
                if not got:
                    sys.exit("[watch] yt-dlp audio download failed:\n" + r.stderr[-600:])
                text = groq_transcribe(to_audio(got[0], tmp), tmp)
                method = "groq-whisper"
        else:
            text = groq_transcribe(to_audio(src, tmp), tmp)
            method = "groq-whisper"

        if not text:
            sys.exit("[watch] no transcript produced")

        frames = visual_frames(src, slug, tmp, urly) if a.visual else None

    if a.no_save:
        print(text)
        return
    path = save_source(text, {
        "title": title, "slug": slug, "source": src,
        "source_type": "youtube" if (urly and re.search(r"youtu\.?be", src)) else ("url" if urly else "local"),
        "captured": datetime.datetime.now().isoformat(timespec="seconds"),
        "date": datetime.date.today().isoformat(),
        "anchor": f"watch-{datetime.date.today().isoformat()}-{slug}",
        "scope": a.scope, "method": method, "frames": frames,
    })
    print(f"saved: {path}")
    print(f"method: {method} | {len(text)} chars" + (f" | frames: {frames}" if frames else ""))


if __name__ == "__main__":
    main()
