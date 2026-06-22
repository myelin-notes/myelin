use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, Transact, Update};

pub(crate) const TYPE_TEXT: i64 = 1;
pub(crate) const TYPE_PAGE_FRAME: i64 = 3;
pub(crate) const TYPE_AUDIO: i64 = 7;

pub(crate) fn any_to_i64(any: &Any) -> Option<i64> {
    match any {
        Any::BigInt(n) => Some(*n),
        Any::Number(n) => Some(*n as i64),
        _ => None,
    }
}

pub(crate) fn any_to_string(any: &Any) -> Option<String> {
    match any {
        Any::String(s) => Some(s.to_string()),
        _ => None,
    }
}

/// Collapse intra-line whitespace, normalize newlines, cap blank-line runs at
/// one, and trim — a lightweight echo of `normalizePreviewText`.
pub(crate) fn normalize(input: &str) -> String {
    let unified = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(unified.len());
    let mut newline_run = 0usize;
    let mut pending_space = false;

    for ch in unified.chars() {
        if ch == '\n' {
            newline_run += 1;
            pending_space = false;
            continue;
        }
        if newline_run > 0 {
            for _ in 0..newline_run.min(2) {
                out.push('\n');
            }
            newline_run = 0;
        }
        if ch == ' ' || ch == '\t' || ch == '\u{000B}' || ch == '\u{000C}' {
            pending_space = true;
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(ch);
    }

    out.trim().to_string()
}

pub(crate) fn decode_doc(bytes: &[u8]) -> Result<Doc, String> {
    let doc = Doc::new();
    let update = Update::decode_v1(bytes).map_err(|e| format!("decode update: {e}"))?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|e| format!("apply update: {e}"))?;
    Ok(doc)
}
