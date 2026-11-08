//! Frame rate of a video file, read from the container so timecodes and
//! exports are right without the user setting it: MP4/MOV (the sample
//! durations of the video track) and Matroska/WebM (the video track's
//! default frame duration).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Frame rate of the first video track. Variable frame rate files (screen
/// recordings, messenger videos) report their highest steady rate: that is
/// the rate they were recorded at, and the one editing software works with.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct FrameRate {
    pub fps: f64,
    pub variable: bool,
}

/// Frames per second of the first video track, if the container says.
pub fn frame_rate(path: &Path) -> Option<FrameRate> {
    let mut file = File::open(path).ok()?;
    let mut magic = [0u8; 12];
    file.read_exact(&mut magic).ok()?;
    file.seek(SeekFrom::Start(0)).ok()?;
    if magic[..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        matroska_frame_rate(&mut file)
    } else if &magic[4..8] == b"ftyp" || &magic[4..8] == b"moov" || &magic[4..8] == b"mdat" || &magic[4..8] == b"wide" || &magic[4..8] == b"free" {
        mp4_frame_rate(&mut file)
    } else {
        None
    }
}

// ---------- MP4 / QuickTime ----------

fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn be64(b: &[u8], at: usize) -> Option<u64> {
    b.get(at..at + 8).map(|s| u64::from_be_bytes(s.try_into().unwrap()))
}

/// Boxes directly inside `data`: (type, payload).
fn boxes(data: &[u8]) -> Vec<(&[u8], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= data.len() {
        let Some(size32) = be32(data, at) else { break };
        let kind = &data[at + 4..at + 8];
        let (header, size) = match size32 {
            1 => match be64(data, at + 8).and_then(|s| usize::try_from(s).ok()) {
                Some(s) => (16usize, s),
                None => break,
            },
            0 => (8, data.len() - at),
            s => (8, s as usize),
        };
        let Some(end) = at.checked_add(size) else { break };
        if size < header || end > data.len() {
            break;
        }
        out.push((kind, &data[at + header..end]));
        at = end;
    }
    out
}

fn child<'a>(data: &'a [u8], kind: &[u8]) -> Option<&'a [u8]> {
    boxes(data).into_iter().find(|(k, _)| *k == kind).map(|(_, p)| p)
}

/// Reads the top-level `moov` box (it may come after the media data).
fn read_moov(file: &mut File) -> Option<Vec<u8>> {
    let len = file.seek(SeekFrom::End(0)).ok()?;
    let mut at = 0u64;
    while at + 8 <= len {
        file.seek(SeekFrom::Start(at)).ok()?;
        let mut head = [0u8; 16];
        let n = file.read(&mut head).ok()?;
        if n < 8 {
            return None;
        }
        let size32 = u32::from_be_bytes([head[0], head[1], head[2], head[3]]) as u64;
        let (header, size) = match size32 {
            1 if n >= 16 => (16, u64::from_be_bytes(head[8..16].try_into().ok()?)),
            0 => (8, len - at),
            s => (8, s),
        };
        if size < header {
            return None;
        }
        if &head[4..8] == b"moov" {
            // A movie header is small; refuse anything absurd.
            if size > 256 * 1024 * 1024 {
                return None;
            }
            let mut moov = vec![0u8; (size - header) as usize];
            file.seek(SeekFrom::Start(at + header)).ok()?;
            file.read_exact(&mut moov).ok()?;
            return Some(moov);
        }
        at = at.checked_add(size)?;
    }
    None
}

fn mp4_frame_rate(file: &mut File) -> Option<FrameRate> {
    let moov = read_moov(file)?;
    for (kind, trak) in boxes(&moov) {
        if kind != b"trak" {
            continue;
        }
        let mdia = child(trak, b"mdia")?;
        let hdlr = child(mdia, b"hdlr")?;
        if hdlr.get(8..12) != Some(b"vide") {
            continue;
        }
        let mdhd = child(mdia, b"mdhd")?;
        let timescale = if mdhd.first() == Some(&1) { be32(mdhd, 20)? } else { be32(mdhd, 12)? };
        let stts = child(child(child(mdia, b"minf")?, b"stbl")?, b"stts")?;
        let entries = be32(stts, 4)? as usize;
        let mut runs: Vec<(u64, u32)> = Vec::with_capacity(entries.min(100_000));
        for i in 0..entries {
            let count = be32(stts, 8 + i * 8)? as u64;
            let delta = be32(stts, 12 + i * 8)?;
            if count > 0 && delta > 0 {
                runs.push((count, delta));
            }
        }
        let total: u64 = runs.iter().map(|r| r.0).sum();
        if timescale == 0 || total == 0 {
            return None;
        }
        // Frames per sample duration.
        let mut by_delta: std::collections::BTreeMap<u32, u64> = std::collections::BTreeMap::new();
        for (count, delta) in &runs {
            *by_delta.entry(*delta).or_default() += count;
        }
        let (&dominant, &share) = by_delta.iter().max_by_key(|(_, c)| **c)?;
        // Constant rate: nearly all frames last the same (a few odd ones are normal).
        if share * 10 >= total * 9 {
            return Some(FrameRate { fps: timescale as f64 / dominant as f64, variable: false });
        }
        // Variable rate: the shortest duration that a real share of the frames have.
        let shortest = by_delta.iter().find(|(_, c)| **c * 50 >= total && **c >= 2).map(|(d, _)| *d).unwrap_or(dominant);
        return Some(FrameRate { fps: timescale as f64 / shortest as f64, variable: true });
    }
    None
}

// ---------- Matroska / WebM ----------

/// An EBML variable-length integer at `at`: (value, length). For ids the marker bit is kept.
fn vint(b: &[u8], at: usize, keep_marker: bool) -> Option<(u64, usize)> {
    let first = *b.get(at)?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || at + len > b.len() {
        return None;
    }
    let mut value = if keep_marker { first as u64 } else { (first as u64) & ((1u64 << (8 - len)) - 1) };
    for i in 1..len {
        value = (value << 8) | b[at + i] as u64;
    }
    Some((value, len))
}

/// Elements directly inside `data`: (id, payload). An unknown size runs to the end.
fn elements(data: &[u8]) -> Vec<(u64, &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < data.len() {
        let Some((id, il)) = vint(data, at, true) else { break };
        let Some((size, sl)) = vint(data, at + il, false) else { break };
        let start = at + il + sl;
        let unknown = size == (1u64 << (7 * sl)) - 1;
        let end = if unknown { data.len() } else { start.saturating_add(size as usize).min(data.len()) };
        out.push((id, &data[start.min(data.len())..end]));
        at = end;
    }
    out
}

fn uint(b: &[u8]) -> u64 {
    b.iter().fold(0u64, |v, x| (v << 8) | *x as u64)
}

const SEGMENT: u64 = 0x1853_8067;
const TRACKS: u64 = 0x1654_AE6B;
const TRACK_ENTRY: u64 = 0xAE;
const TRACK_TYPE: u64 = 0x83;
const DEFAULT_DURATION: u64 = 0x23_E383;

fn matroska_frame_rate(file: &mut File) -> Option<FrameRate> {
    // The track list sits before the clusters, near the start of the file.
    let mut head = Vec::new();
    file.take(8 * 1024 * 1024).read_to_end(&mut head).ok()?;
    let (_, segment) = elements(&head).into_iter().find(|(id, _)| *id == SEGMENT)?;
    let (_, tracks) = elements(segment).into_iter().find(|(id, _)| *id == TRACKS)?;
    for (id, entry) in elements(tracks) {
        if id != TRACK_ENTRY {
            continue;
        }
        let fields = elements(entry);
        let video = fields.iter().any(|(id, v)| *id == TRACK_TYPE && uint(v) == 1);
        let duration = fields.iter().find(|(id, _)| *id == DEFAULT_DURATION).map(|(_, v)| uint(v));
        if let (true, Some(ns)) = (video, duration) {
            if ns > 0 {
                return Some(FrameRate { fps: 1e9 / ns as f64, variable: false });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fps(name: &str) -> Option<f64> {
        rate(name).map(|r| r.fps)
    }

    fn rate(name: &str) -> Option<FrameRate> {
        frame_rate(&Path::new(env!("CARGO_MANIFEST_DIR")).join("test-data").join(name))
    }

    #[test]
    fn reads_the_frame_rate_of_common_containers() {
        let close = |a: Option<f64>, b: f64| a.map(|a| (a - b).abs() < 0.01).unwrap_or(false);
        assert!(close(fps("r30.mp4"), 30.0), "{:?}", fps("r30.mp4"));
        assert!(close(fps("r23976.mov"), 23.976), "{:?}", fps("r23976.mov"));
        assert!(close(fps("r2997-moovatend.mp4"), 29.97), "{:?}", fps("r2997-moovatend.mp4"));
        assert!(close(fps("r25.webm"), 25.0), "{:?}", fps("r25.webm"));
        assert!(!rate("r30.mp4").unwrap().variable);
    }

    #[test]
    fn variable_rate_files_report_the_rate_they_were_recorded_at() {
        // 60 fps with many frames dropped: about 27 fps on average.
        let r = rate("vfr60.mp4").expect("a rate");
        assert!(r.variable);
        assert!((r.fps - 60.0).abs() < 0.01, "{r:?}");
    }

    #[test]
    fn other_files_have_no_frame_rate() {
        assert_eq!(frame_rate(&Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")), None);
    }
}
