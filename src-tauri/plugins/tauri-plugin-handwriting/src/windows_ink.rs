use std::sync::OnceLock;

use windows::Foundation::Point;
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::UI::Input::Inking::{
    InkPoint, InkRecognitionTarget, InkRecognizerContainer, InkStrokeBuilder, InkStrokeContainer,
};
use windows_collections::IIterable;
use windows_numerics::Matrix3x2;

use crate::Stroke;

// Matches Pointer Events' "no sensor" value; the recognizer reads shape, not pressure.
const PRESSURE: f32 = 0.5;

/// Windows Ink's recognizer for the system language, one recognized word per result.
pub fn recognize(strokes: &[Stroke]) -> Result<String, String> {
    recognize_strokes(strokes).map_err(|error| error.message())
}

fn recognize_strokes(strokes: &[Stroke]) -> windows::core::Result<String> {
    ensure_mta();
    let builder = InkStrokeBuilder::new()?;
    let container = InkStrokeContainer::new()?;
    for stroke in strokes {
        // Dots add little to a word, and single-point ink strokes are an untested edge for the API.
        if stroke.points.len() < 4 {
            continue;
        }
        let points = stroke
            .points
            .as_chunks::<2>()
            .0
            .iter()
            .map(|point| {
                InkPoint::CreateInkPoint(
                    Point {
                        X: point[0],
                        Y: point[1],
                    },
                    PRESSURE,
                )
                .map(Some)
            })
            .collect::<windows::core::Result<Vec<_>>>()?;
        let ink =
            builder.CreateStrokeFromInkPoints(&IIterable::from(points), Matrix3x2::identity())?;
        container.AddStroke(&ink)?;
    }
    if container.GetStrokes()?.Size()? == 0 {
        return Ok(String::new());
    }

    // Activation fails when no handwriting recognizer is installed for any language.
    let results = InkRecognizerContainer::new()?
        .RecognizeAsync(&container, InkRecognitionTarget::All)?
        .join()?;
    let mut words = Vec::new();
    for result in results {
        let candidates = result.GetTextCandidates()?;
        if candidates.Size()? > 0 {
            words.push(candidates.GetAt(0)?.to_string());
        }
    }
    Ok(words.join(" "))
}

// WinRT activation fails on a thread with no COM apartment, and `spawn_blocking` threads have none.
// An implicit process MTA covers every such thread; the ink classes allow either apartment.
fn ensure_mta() {
    static MTA: OnceLock<()> = OnceLock::new();
    MTA.get_or_init(|| {
        let _ = unsafe { CoIncrementMTAUsage() };
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_ink::hello;

    #[test]
    fn reads_drawn_strokes() {
        assert_eq!(recognize(&hello()).unwrap().to_uppercase(), "HELLO");
    }
}
