// renderers/fframes/src/main.rs
// Slopscore 2.0 — Rust `fframes` vector & raster frame renderer.
// Reads `out/context.bin` (32 little-endian f32 per frame, CONTRACTS.md §3) and emits
// either precision SVG keyframes (`svg --ctx <context.bin> --index 0 --out frame.svg`)
// or raw RGB24 frames to stdout (`video --ctx <context.bin> --w 1280 --h 720`).

use std::env;
use std::fs;
use std::io::{self, Write};

pub const CONTEXT_STRIDE: usize = 32;
pub const DUAL_PARTICLE_COUNT: usize = 420;
pub const GOLDEN_ANGLE: f32 = 2.3999632;

#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
pub struct SlopContextFrame {
    pub time: f32,
    pub bar: f32,
    pub beat_phase: f32,
    pub measure_phase: f32,
    pub phrase_4bar: f32,
    pub chapter: f32,
    pub next_chapter: f32,
    pub ch_progress: f32,
    pub ch_morph_t: f32,
    pub rms: f32,
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    pub transient: f32,
    pub glitch: f32,
    pub pan_x: f32,
    pub pan_y: f32,
    pub dist: f32,
    pub fov: f32,
    pub roll: f32,
    pub char_scale: f32,
    pub clip_a: f32,
    pub clip_b: f32,
    pub frame_a: f32,
    pub frame_b: f32,
    pub rig_a: f32,
    pub rig_b: f32,
    pub vp_u: f32,
    pub vp_v: f32,
    pub scanlines: f32,
    pub chroma: f32,
    pub relief_depth: f32,
}

impl SlopContextFrame {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let mut f = [0.0f32; CONTEXT_STRIDE];
        for (i, slot) in f.iter_mut().enumerate() {
            let b = i * 4;
            if b + 4 <= bytes.len() {
                *slot = f32::from_le_bytes([bytes[b], bytes[b + 1], bytes[b + 2], bytes[b + 3]]);
            }
        }
        Self {
            time: f[0],
            bar: f[1],
            beat_phase: f[2],
            measure_phase: f[3],
            phrase_4bar: f[4],
            chapter: f[5],
            next_chapter: f[6],
            ch_progress: f[7],
            ch_morph_t: f[8],
            rms: f[9],
            bass: f[10],
            mid: f[11],
            high: f[12],
            transient: f[13],
            glitch: f[14],
            pan_x: f[15],
            pan_y: f[16],
            dist: f[17],
            fov: f[18],
            roll: f[19],
            char_scale: f[20],
            clip_a: f[21],
            clip_b: f[22],
            frame_a: f[23],
            frame_b: f[24],
            rig_a: f[25],
            rig_b: f[26],
            vp_u: f[27],
            vp_v: f[28],
            scanlines: f[29],
            chroma: f[30],
            relief_depth: f[31],
        }
    }
}

fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo { lo } else if v > hi { hi } else { v }
}

fn fov_to_px(fov_deg: f32, height: f32) -> f32 {
    let rad = clamp(fov_deg, 15.0, 140.0) * std::f32::consts::PI / 360.0;
    (height * 0.5) / rad.tan()
}

pub fn render_svg(c: &SlopContextFrame, w: usize, h: usize) -> String {
    let wf = w as f32;
    let hf = h as f32;
    let fov_px = fov_to_px(if c.fov > 1.0 { c.fov } else { 56.0 }, hf);
    let cam_dist = if c.dist > 0.5 { c.dist } else { 14.0 };
    let cx = c.vp_u * wf;
    let cy = c.vp_v * hf;
    let r_base = wf.min(hf) * (0.18 + c.bass * 0.06);

    let mut out = String::with_capacity(32768);
    out.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {} {}\" width=\"{}\" height=\"{}\">\n",
        w, h, w, h
    ));
    out.push_str(&format!("<rect width=\"{}\" height=\"{}\" fill=\"#050811\"/>\n", w, h));
    out.push_str(&format!(
        "<circle cx=\"{:.1}\" cy=\"{:.1}\" r=\"{:.1}\" stroke=\"#26f2eb\" stroke-opacity=\"0.38\" fill=\"none\" stroke-dasharray=\"6 4\"/>\n",
        cx, cy, r_base
    ));

    out.push_str("<g>\n");
    for i in 0..DUAL_PARTICLE_COUNT {
        let fi = i as f32;
        let ang = fi * GOLDEN_ANGLE + c.time * 1.1;
        let rad = (fi / DUAL_PARTICLE_COUNT as f32).sqrt() * (3.6 + c.bass * 1.1);
        let x = ang.cos() * rad;
        let y = ((fi / DUAL_PARTICLE_COUNT as f32) - 0.5) * 4.8;
        let z = ang.sin() * rad + cam_dist;
        if z < 0.7 {
            continue;
        }
        let sx = wf * c.pan_x + (x / z) * fov_px;
        let sy = hf * c.pan_y + (y / z) * fov_px;
        let sz = clamp(26.0 / z, 2.0, 6.5) * (1.0 + c.transient * 0.7);
        let col = if i % 3 == 0 { "#26f2eb" } else if i % 3 == 1 { "#ffd147" } else { "#f261d9" };
        out.push_str(&format!(
            "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{}\" fill-opacity=\"0.85\"/>\n",
            sx - sz * 0.5, sy - sz * 0.5, sz, sz, col
        ));
    }
    out.push_str("</g>\n</svg>\n");
    out
}

pub fn render_rgb24(c: &SlopContextFrame, w: usize, h: usize, buf: &mut [u8]) {
    let wf = w as f32;
    let hf = h as f32;
    for y in 0..h {
        let v = y as f32 / hf;
        let scan = if c.scanlines > 0.0 && y % 2 == 1 { 0.88 } else { 1.0 };
        let wave = (v * 160.0 + c.time * 3.0).sin() * 0.5 + 0.5;
        for x in 0..w {
            let u = x as f32 / wf;
            let dx = u - c.vp_u;
            let dy = v - c.vp_v;
            let dist = (dx * dx + dy * dy).sqrt();
            let ring = ((dist * 38.0 - c.time * 2.4).sin()).abs();
            let glow = clamp(1.0 - dist * 1.8, 0.0, 1.0) * (0.25 + c.bass * 0.45 + ring * 0.25);
            let r = clamp((0.04 + glow * 0.85 + wave * 0.05) * scan, 0.0, 1.0);
            let g = clamp((0.07 + glow * 0.92 + wave * 0.08) * scan, 0.0, 1.0);
            let b = clamp((0.12 + glow * 0.96 + wave * 0.10) * scan, 0.0, 1.0);
            let idx = (y * w + x) * 3;
            buf[idx] = (r * 255.0) as u8;
            buf[idx + 1] = (g * 255.0) as u8;
            buf[idx + 2] = (b * 255.0) as u8;
        }
    }
}

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: slopscore-fframes <svg|video> --ctx <context.bin> [--index 0] [--out frame.svg] [--w 1280] [--h 720]");
        std::process::exit(1);
    }

    let mode = &args[1];
    let mut ctx_path = String::new();
    let mut out_path = String::new();
    let mut index: usize = 0;
    let mut w: usize = 1280;
    let mut h: usize = 720;

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--ctx" if i + 1 < args.len() => { ctx_path = args[i + 1].clone(); i += 2; }
            "--out" if i + 1 < args.len() => { out_path = args[i + 1].clone(); i += 2; }
            "--index" if i + 1 < args.len() => { index = args[i + 1].parse().unwrap_or(0); i += 2; }
            "--w" if i + 1 < args.len() => { w = args[i + 1].parse().unwrap_or(1280); i += 2; }
            "--h" if i + 1 < args.len() => { h = args[i + 1].parse().unwrap_or(720); i += 2; }
            _ => { i += 1; }
        }
    }

    let data = fs::read(&ctx_path)?;
    let rec_bytes = CONTEXT_STRIDE * 4;
    let count = data.len() / rec_bytes;

    if mode == "svg" {
        let idx = index.min(count.saturating_sub(1));
        let start = idx * rec_bytes;
        let frame = SlopContextFrame::from_bytes(&data[start..start + rec_bytes]);
        let svg = render_svg(&frame, w, h);
        if out_path.is_empty() {
            io::stdout().write_all(svg.as_bytes())?;
        } else {
            fs::write(&out_path, svg)?;
        }
    } else if mode == "video" {
        let mut stdout = io::stdout().lock();
        let mut rgb = vec![0u8; w * h * 3];
        for f in 0..count {
            let start = f * rec_bytes;
            let frame = SlopContextFrame::from_bytes(&data[start..start + rec_bytes]);
            render_rgb24(&frame, w, h, &mut rgb);
            stdout.write_all(&rgb)?;
        }
        stdout.flush()?;
    }

    Ok(())
}
