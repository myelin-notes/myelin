use crate::Stroke;

// Block capitals, 40 units tall, as a pen would draw them.
fn letter(glyph: char, left: f32) -> Vec<Stroke> {
    let line = |points: &[(f32, f32)]| Stroke {
        points: points
            .iter()
            .flat_map(|(x, y)| [left + x, y * 40.0])
            .collect(),
        width: 3.0,
    };
    match glyph {
        'H' => vec![
            line(&[(0.0, 0.0), (0.0, 1.0)]),
            line(&[(24.0, 0.0), (24.0, 1.0)]),
            line(&[(0.0, 0.5), (24.0, 0.5)]),
        ],
        'E' => vec![
            line(&[(22.0, 0.0), (0.0, 0.0), (0.0, 1.0), (22.0, 1.0)]),
            line(&[(0.0, 0.5), (16.0, 0.5)]),
        ],
        'L' => vec![line(&[(0.0, 0.0), (0.0, 1.0), (22.0, 1.0)])],
        'O' => vec![line(
            &(0..=24)
                .map(|i| {
                    let angle = i as f32 / 24.0 * std::f32::consts::TAU;
                    (12.0 + 12.0 * angle.cos(), 0.5 + 0.5 * angle.sin())
                })
                .collect::<Vec<_>>(),
        )],
        _ => unreachable!(),
    }
}

/// "HELLO" in block capitals, drawn stroke by stroke.
pub fn hello() -> Vec<Stroke> {
    "HELLO"
        .chars()
        .enumerate()
        .flat_map(|(index, glyph)| letter(glyph, index as f32 * 36.0))
        .collect()
}
