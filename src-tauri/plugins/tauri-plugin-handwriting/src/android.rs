use serde::Serialize;
use tauri::{plugin::PluginHandle, AppHandle, Manager, Runtime};

use crate::{lines::split_lines, Stroke};

pub struct MlKit<R: Runtime>(pub PluginHandle<R>);

#[derive(Serialize)]
struct RecognizeLines<'a> {
    /// Each line's strokes as flat `[x, y, ...]` point lists.
    lines: Vec<Vec<&'a [f32]>>,
}

/// ML Kit reads one line of text per ink, so each block goes over as its lines and comes back
/// joined with `\n`.
pub fn recognize<R: Runtime>(
    app: &AppHandle<R>,
    blocks: &[Vec<Stroke>],
) -> Result<Vec<String>, String> {
    let blocks: Vec<Vec<Vec<&Stroke>>> = blocks.iter().map(|block| split_lines(block)).collect();
    let lines = blocks
        .iter()
        .flatten()
        .map(|line| line.iter().map(|stroke| stroke.points.as_slice()).collect())
        .collect();
    let texts: Vec<String> = app
        .state::<MlKit<R>>()
        .0
        .run_mobile_plugin("recognize", RecognizeLines { lines })
        .map_err(|error| error.to_string())?;

    let mut texts = texts.into_iter();
    Ok(blocks
        .iter()
        .map(|lines| {
            texts
                .by_ref()
                .take(lines.len())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .collect())
}
