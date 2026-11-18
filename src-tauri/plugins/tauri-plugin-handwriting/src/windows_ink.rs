use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use windows::Foundation::Point;
use windows::Win32::Foundation::E_ILLEGAL_METHOD_CALL;
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
    // Windows.UI.Input.Inking crashes (STATUS_ACCESS_VIOLATION) when strokes are built on two
    // threads at once, or when a recognizer is released right after its completion handler fires,
    // while its worker is still finishing. So every call holds this lock throughout, and one
    // recognizer lives for the process; reuse also skips its ~100ms setup per call.
    static RECOGNIZER: Mutex<Option<MtaRecognizer>> = Mutex::new(None);
    let mut recognizer = RECOGNIZER.lock().unwrap_or_else(PoisonError::into_inner);
    if recognizer.is_none() {
        // Activation fails when no handwriting recognizer is installed for any language.
        *recognizer = Some(MtaRecognizer(InkRecognizerContainer::new()?));
    }
    let recognizer = &recognizer.as_ref().unwrap().0;
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

    // A call while the recognizer finishes the previous one fails with E_ILLEGAL_METHOD_CALL; it
    // clears within milliseconds.
    let mut attempts = 0;
    let operation = loop {
        match recognizer.RecognizeAsync(&container, InkRecognitionTarget::All) {
            Err(error) if error.code() == E_ILLEGAL_METHOD_CALL && attempts < 100 => {
                attempts += 1;
                std::thread::sleep(Duration::from_millis(5));
            }
            result => break result?,
        }
    };
    let results = operation.join()?;
    let mut words = Vec::new();
    for result in results {
        let candidates = result.GetTextCandidates()?;
        if candidates.Size()? > 0 {
            words.push(candidates.GetAt(0)?.to_string());
        }
    }
    Ok(words.join(" "))
}

struct MtaRecognizer(InkRecognizerContainer);

// SAFETY: created and only used on threads in the process MTA (`ensure_mta`), where a COM object
// needs no marshaling between threads.
unsafe impl Send for MtaRecognizer {}

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

    #[test]
    fn survives_concurrent_calls() {
        let threads: Vec<_> = (0..8)
            .map(|_| {
                std::thread::spawn(|| {
                    for _ in 0..20 {
                        assert_eq!(recognize(&hello()).unwrap().to_uppercase(), "HELLO");
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
    }
}
