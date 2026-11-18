use crate::Stroke;

// Caps memory and recognizer time for a page-sized block; Vision downsamples larger input anyway.
const MAX_SIDE_PX: f32 = 2048.0;
const MAX_SCALE: f32 = 2.0;
const PADDING_PX: f32 = 16.0;
const MIN_LINE_WIDTH_PX: f32 = 2.0;

/// Black ink on white as an 8-bit grayscale PNG; `None` when there are no points to draw.
pub fn render_png(strokes: &[Stroke]) -> Result<Option<Vec<u8>>, String> {
    let Some((pixels, width, height)) = render(strokes) else {
        return Ok(None);
    };
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(&pixels))
        .map_err(|error| error.to_string())?;
    Ok(Some(png))
}

fn render(strokes: &[Stroke]) -> Option<(Vec<u8>, u32, u32)> {
    let (mut min_x, mut min_y) = (f32::INFINITY, f32::INFINITY);
    let (mut max_x, mut max_y) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    for stroke in strokes {
        for point in stroke.points.as_chunks::<2>().0 {
            min_x = min_x.min(point[0]);
            min_y = min_y.min(point[1]);
            max_x = max_x.max(point[0]);
            max_y = max_y.max(point[1]);
        }
    }
    if !min_x.is_finite() || !max_x.is_finite() {
        return None;
    }

    let scale = MAX_SCALE.min(MAX_SIDE_PX / (max_x - min_x).max(max_y - min_y).max(1.0));
    let width = ((max_x - min_x) * scale + 2.0 * PADDING_PX).ceil() as usize;
    let height = ((max_y - min_y) * scale + 2.0 * PADDING_PX).ceil() as usize;
    let mut pixels = vec![255u8; width * height];
    let to_px = |x: f32, y: f32| {
        (
            (x - min_x) * scale + PADDING_PX,
            (y - min_y) * scale + PADDING_PX,
        )
    };

    for stroke in strokes {
        let radius = (stroke.width * scale).max(MIN_LINE_WIDTH_PX) / 2.0;
        let points: Vec<(f32, f32)> = stroke
            .points
            .as_chunks::<2>()
            .0
            .iter()
            .map(|point| to_px(point[0], point[1]))
            .collect();
        match points.as_slice() {
            [] => {}
            [only] => stamp_segment(&mut pixels, width, height, *only, *only, radius),
            _ => {
                for pair in points.windows(2) {
                    stamp_segment(&mut pixels, width, height, pair[0], pair[1], radius);
                }
            }
        }
    }
    Some((pixels, width as u32, height as u32))
}

fn stamp_segment(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    a: (f32, f32),
    b: (f32, f32),
    radius: f32,
) {
    let x0 = (a.0.min(b.0) - radius).floor().max(0.0) as usize;
    let y0 = (a.1.min(b.1) - radius).floor().max(0.0) as usize;
    let x1 = ((a.0.max(b.0) + radius).ceil() as usize).min(width - 1);
    let y1 = ((a.1.max(b.1) + radius).ceil() as usize).min(height - 1);
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length_sq = dx * dx + dy * dy;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let t = if length_sq == 0.0 {
                0.0
            } else {
                (((px - a.0) * dx + (py - a.1) * dy) / length_sq).clamp(0.0, 1.0)
            };
            let (ex, ey) = (px - (a.0 + t * dx), py - (a.1 + t * dy));
            if ex * ex + ey * ey <= radius * radius {
                pixels[y * width + x] = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(points: &[f32], width: f32) -> Stroke {
        Stroke {
            points: points.to_vec(),
            width,
        }
    }

    #[test]
    fn draws_ink_where_the_stroke_runs_and_nowhere_else() {
        let (pixels, width, height) = render(&[stroke(&[0.0, 0.0, 100.0, 0.0], 4.0)]).unwrap();
        let (width, height) = (width as usize, height as usize);
        let ink_rows: Vec<usize> = (0..height)
            .filter(|&y| pixels[y * width..(y + 1) * width].contains(&0))
            .collect();
        // 4 world units at 2x scale is an 8px line centred in the padded 1px-tall bounds.
        assert_eq!(ink_rows.len(), 8);
        assert!(ink_rows.iter().all(|&y| (12..=20).contains(&y)));
        let midline = &pixels[16 * width..17 * width];
        assert!(midline[16..216].iter().all(|&p| p == 0));
        assert_eq!(midline[0], 255);
        assert_eq!(midline[width - 1], 255);
    }

    #[test]
    fn caps_large_blocks_and_keeps_dots_visible() {
        let (pixels, width, height) = render(&[
            stroke(&[0.0, 0.0, 8192.0, 4096.0], 1.0),
            stroke(&[40.0, 4000.0], 1.0),
        ])
        .unwrap();
        assert_eq!(width, 2048 + 32);
        assert_eq!(height, 1024 + 32);
        // Downscaled 4x, the 0.25px dot is widened to the minimum line width at (26, 1016).
        let dot = 1016 * width as usize + 26;
        assert_eq!(pixels[dot], 0);
    }

    #[test]
    fn skips_blocks_without_points() {
        assert!(render(&[stroke(&[], 2.0)]).is_none());
    }
}
