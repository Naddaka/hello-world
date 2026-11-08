//! Frame rate of a video file, read from the container so timecodes and
//! exports are right without the user setting it: MP4/MOV (the sample
//! durations of the video track) and Matroska/WebM (the video track's
//! default frame duration).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Frames per second of the first video track, if the container says.
pub fn frame_rate(path: &Path) -> Option<f64> {
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
            1 => match be64(data, at + 8) {
                Some(s) => (16usize, s as usize),
                None => break,
            },
            0 => (8, data.len() - at),
            s => (8, s as usize),
        };
        if size < header || at + size > data.len() {
            break;
        }
        out.push((kind, &data[at + header..at + size]));
        at += size;
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
        at += size;
    }
    None
}

fn mp4_frame_rate(file: &mut File) -> Option<f64> {
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
        // The most common sample duration (variable frame rate phone videos have a few odd ones).
        let mut best = (0u64, 0u32);
        let mut total = (0u64, 0u64);
        for i in 0..entries {
            let count = be32(stts, 8 + i * 8)? as u64;
            let delta = be32(stts, 12 + i * 8)?;
            total = (total.0 + count, total.1 + count * delta as u64);
            if count > best.0 && delta > 0 {
                best = (count, delta);
            }
        }
        if timescale == 0 || best.1 == 0 {
            return None;
        }
        // If most frames share one duration use it; otherwise the average.
        let fps = if best.0 * 2 >= total.0 { timescale as f64 / best.1 as f64 } else { timescale as f64 * total.0 as f64 / total.1 as f64 };
        return Some(fps);
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

fn matroska_frame_rate(file: &mut File) -> Option<f64> {
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
                return Some(1e9 / ns as f64);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fps(name: &str) -> Option<f64> {
        frame_rate(&Path::new(env!("CARGO_MANIFEST_DIR")).join("test-data").join(name))
    }

    #[test]
    fn reads_the_frame_rate_of_common_containers() {
        let close = |a: Option<f64>, b: f64| a.map(|a| (a - b).abs() < 0.01).unwrap_or(false);
        assert!(close(fps("r30.mp4"), 30.0), "{:?}", fps("r30.mp4"));
        assert!(close(fps("r23976.mov"), 23.976), "{:?}", fps("r23976.mov"));
        assert!(close(fps("r2997-moovatend.mp4"), 29.97), "{:?}", fps("r2997-moovatend.mp4"));
        assert!(close(fps("r25.webm"), 25.0), "{:?}", fps("r25.webm"));
    }

    #[test]
    fn other_files_have_no_frame_rate() {
        assert_eq!(frame_rate(&Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")), None);
    }
}
