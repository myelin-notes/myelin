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
    use crate::{raster::render_png, test_ink::hello};

    #[test]
    fn reads_drawn_strokes() {
        let png = render_png(&hello()).unwrap().unwrap();
        assert_eq!(recognize_png(&png).unwrap().to_uppercase(), "HELLO");
    }
}
