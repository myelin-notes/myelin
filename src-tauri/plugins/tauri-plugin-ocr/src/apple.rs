//! macOS OCR backend built on Apple's Vision framework.
//!
//! Wraps the caller's grayscale bytes in a `CGImage` and runs a
//! `VNRecognizeTextRequest` over it. Vision runs entirely on-device and needs
//! no entitlement, network, or main thread, so this is safe to call from the
//! handwriting worker.

#[cfg(debug_assertions)]
use std::time::Instant;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_core_foundation::{CFData, CFRetained};
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage,
};
use objc2_foundation::{NSArray, NSDictionary};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
    VNRequestTextRecognitionLevel,
};

use crate::{GrayImage, OcrLine};

/// At most this many candidate strings are requested per recognized region; we
/// only keep the top one.
const MAX_CANDIDATES: usize = 1;

/// Trace Vision calls on stderr in debug builds only.
macro_rules! debug_log {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)]
        eprintln!("ocr: {}", format_args!($($arg)*));
    }};
}

pub fn recognize(image: &GrayImage) -> Result<Vec<OcrLine>, String> {
    objc2::rc::autoreleasepool(|_| {
        #[cfg(debug_assertions)]
        let started = Instant::now();
        debug_log!("Vision request for {}x{} image", image.width, image.height);
        let cg = make_cg_image(image)?;

        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);

        let options: Retained<NSDictionary<VNImageOption, AnyObject>> = NSDictionary::new();
        let handler = unsafe {
            VNImageRequestHandler::initWithCGImage_options(
                VNImageRequestHandler::alloc(),
                &cg,
                &options,
            )
        };

        let request_ref: &VNRequest = &request;
        let requests = NSArray::from_slice(&[request_ref]);
        handler
            .performRequests_error(&requests)
            .map_err(|e| format!("vision request failed: {e}"))?;

        let mut lines = Vec::new();
        if let Some(observations) = request.results() {
            for observation in observations.iter() {
                let candidates = observation.topCandidates(MAX_CANDIDATES);
                let Some(top) = candidates.iter().next() else {
                    continue;
                };
                let text = top.string().to_string();
                if text.trim().is_empty() {
                    continue;
                }
                lines.push(OcrLine {
                    text,
                    confidence: top.confidence(),
                });
            }
        }
        debug_log!(
            "Vision returned {} line(s) in {}ms",
            lines.len(),
            started.elapsed().as_millis()
        );
        Ok(lines)
    })
}

/// Build a `CGImage` over a copy of the grayscale bytes. The bytes are copied
/// into a `CFData` that the returned image retains, so it stays valid for the
/// life of the recognition request.
fn make_cg_image(image: &GrayImage) -> Result<CFRetained<CGImage>, String> {
    let data = CFData::from_bytes(image.pixels);
    let provider =
        CGDataProvider::with_cf_data(Some(&data)).ok_or("create CGDataProvider")?;
    let color_space = CGColorSpace::new_device_gray().ok_or("create gray color space")?;

    let cg = unsafe {
        CGImage::new(
            image.width,
            image.height,
            8,           // bits per component
            8,           // bits per pixel (single gray channel, no alpha)
            image.width, // bytes per row
            Some(&color_space),
            CGBitmapInfo::empty(),
            Some(&provider),
            std::ptr::null(),
            false,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    };
    cg.ok_or_else(|| "create CGImage".to_string())
}
