use objc2::{rc::autoreleasepool, AllocAnyThread};
use objc2_foundation::{NSArray, NSData, NSDictionary};
#[allow(deprecated)]
use objc2_vision::VNRecognizeTextRequestRevision2;
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

/// Vision's `.accurate` text recognizer over a PNG, one line per observation.
pub fn recognize_png(png: &[u8]) -> Result<String, String> {
    autoreleasepool(|_| {
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        // iOS/macOS 27's newer `.accurate` revision drops lines or returns nothing; revision 2
        // doesn't. Revision 2 needs macOS 11 / iOS 14, so 10.15 fails here with an error.
        #[allow(deprecated)]
        unsafe {
            request.setRevision(VNRecognizeTextRequestRevision2)
        };

        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &NSData::with_bytes(png),
            &NSDictionary::new(),
        );
        let as_request: &VNRequest = &request;
        handler
            .performRequests_error(&NSArray::from_slice(&[as_request]))
            .map_err(|error| error.localizedDescription().to_string())?;

        let Some(observations) = request.results() else {
            return Ok(String::new());
        };
        let lines: Vec<String> = observations
            .iter()
            .filter_map(|observation| observation.topCandidates(1).firstObject())
            .map(|candidate| candidate.string().to_string())
            .collect();
        Ok(lines.join("\n"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{raster::render_png, Stroke};

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

    #[test]
    fn reads_drawn_strokes() {
        let strokes: Vec<Stroke> = "HELLO"
            .chars()
            .enumerate()
            .flat_map(|(index, glyph)| letter(glyph, index as f32 * 36.0))
            .collect();
        let png = render_png(&strokes).unwrap().unwrap();
        assert_eq!(recognize_png(&png).unwrap().to_uppercase(), "HELLO");
    }
}
