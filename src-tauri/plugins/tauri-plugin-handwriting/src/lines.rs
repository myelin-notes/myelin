use crate::Stroke;

// A new line starts where consecutive stroke centers (sorted top to bottom) are further apart than
// this fraction of the median stroke height. Biased low: merging two lines garbles both, while
// splitting off an i-dot loses little.
const LINE_GAP_RATIO: f32 = 0.6;

/// Strokes grouped into lines of text, top to bottom, each line in input (drawing) order.
/// Strokes without points are dropped.
pub fn split_lines(strokes: &[Stroke]) -> Vec<Vec<&Stroke>> {
    // (index, vertical center, height)
    let mut spans: Vec<(usize, f32, f32)> = strokes
        .iter()
        .enumerate()
        .filter_map(|(index, stroke)| {
            let ys = stroke.points.as_chunks::<2>().0.iter().map(|[_, y]| *y);
            let top = ys.clone().reduce(f32::min)?;
            let bottom = ys.reduce(f32::max)?;
            Some((index, (top + bottom) / 2.0, bottom - top))
        })
        .collect();

    let mut heights: Vec<f32> = spans.iter().map(|&(_, _, height)| height).collect();
    heights.sort_by(f32::total_cmp);
    let max_gap = heights.get(heights.len() / 2).copied().unwrap_or(0.0) * LINE_GAP_RATIO;

    spans.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut lines: Vec<Vec<usize>> = Vec::new();
    let mut previous_center = f32::NEG_INFINITY;
    for (index, center, _) in spans {
        match lines.last_mut() {
            Some(line) if center - previous_center <= max_gap => line.push(index),
            _ => lines.push(vec![index]),
        }
        previous_center = center;
    }

    lines
        .into_iter()
        .map(|mut members| {
            members.sort_unstable();
            members.into_iter().map(|index| &strokes[index]).collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vertical(x: f32, top: f32, bottom: f32) -> Stroke {
        Stroke {
            points: vec![x, top, x, bottom],
            width: 2.0,
        }
    }

    #[test]
    fn splits_lines_keeping_ascenders_descenders_and_dots_with_their_line() {
        // x-height 10 with baseline at y=30, then a second line with baseline at y=60.
        let strokes = [
            vertical(1.0, 50.0, 60.0),
            vertical(2.0, 20.0, 30.0),
            // Ascender, then a descender hanging below the baseline.
            vertical(3.0, 10.0, 30.0),
            vertical(4.0, 40.0, 60.0),
            vertical(5.0, 20.0, 40.0),
            // An i-dot.
            Stroke {
                points: vec![6.0, 15.0],
                width: 2.0,
            },
            Stroke {
                points: vec![],
                width: 2.0,
            },
        ];

        let lines: Vec<Vec<f32>> = split_lines(&strokes)
            .iter()
            .map(|line| line.iter().map(|stroke| stroke.points[0]).collect())
            .collect();

        assert_eq!(lines, vec![vec![2.0, 3.0, 5.0, 6.0], vec![1.0, 4.0]]);
    }
}
