use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use yrs::{
    updates::{decoder::Decode, encoder::Encode},
    Any, Array, Doc, Map, Out, ReadTxn, StateVector, Text, Transact, Update, XmlFragment, XmlOut,
};

pub(super) fn decode(bytes: &[u8]) -> Result<Doc, String> {
    let doc = Doc::new();
    apply(&doc, bytes)?;
    Ok(doc)
}

pub(super) fn apply(doc: &Doc, bytes: &[u8]) -> Result<bool, String> {
    let changed = Arc::new(AtomicBool::new(false));
    let observed = changed.clone();
    let _subscription = doc
        .observe_update_v1(move |_, _| observed.store(true, Ordering::Relaxed))
        .map_err(|_| "Yjs update observer unavailable")?;
    if !bytes.is_empty() {
        doc.transact_mut()
            .apply_update(Update::decode_v1(bytes).map_err(|_| "Invalid Yjs document update")?)
            .map_err(|_| "Could not apply Yjs document update")?;
    }
    Ok(changed.load(Ordering::Relaxed))
}

pub(super) fn vector(doc: &Doc) -> Vec<u8> {
    doc.transact().state_vector().encode_v1()
}

pub(super) fn bytes(doc: &Doc) -> Vec<u8> {
    doc.transact()
        .encode_state_as_update_v1(&StateVector::default())
}

pub(super) fn diff(doc: &Doc, vector: Option<&[u8]>) -> Result<(Vec<u8>, Vec<u8>), String> {
    let vector = match vector {
        Some(bytes) => StateVector::decode_v1(bytes).map_err(|_| "Invalid Yjs state vector")?,
        None => StateVector::default(),
    };
    let txn = doc.transact();
    Ok((
        txn.encode_state_as_update_v1(&vector),
        txn.state_vector().encode_v1(),
    ))
}

pub(super) fn merge(remote: &[u8], local: &[u8]) -> Result<Vec<u8>, String> {
    let doc = decode(remote)?;
    apply(&doc, local)?;
    Ok(bytes(&doc))
}

fn string(value: &Any) -> Option<&str> {
    if let Any::String(value) = value {
        Some(value)
    } else {
        None
    }
}

fn xml_text<T: ReadTxn>(txn: &T, node: &XmlOut) -> String {
    match node {
        XmlOut::Text(text) => text
            .diff(txn, |_| ())
            .into_iter()
            .filter_map(|part| match part.insert {
                Out::Any(Any::String(value)) => Some(value.to_string()),
                _ => None,
            })
            .collect(),
        XmlOut::Element(element) if matches!(element.tag().as_ref(), "hardBreak" | "mention") => {
            " ".into()
        }
        XmlOut::Element(element) => element
            .children(txn)
            .map(|child| xml_text(txn, &child))
            .collect(),
        XmlOut::Fragment(fragment) => fragment
            .children(txn)
            .map(|child| xml_text(txn, &child))
            .collect(),
    }
}

fn snippet(text: String) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= 180 {
        return text;
    }
    let mut short: String = text.chars().take(177).collect();
    short = short.trim_end().into();
    if let Some(boundary) = short.rfind(' ').filter(|index| *index > 126) {
        short.truncate(boundary);
    }
    format!("{short}...")
}

fn block_links<T: ReadTxn>(txn: &T, children: Vec<XmlOut>, snippet: &str, links: &mut Vec<Value>) {
    let mut previous = Value::Null;
    for child in children {
        let XmlOut::Text(text) = child else {
            previous = Value::Null;
            continue;
        };
        for part in text.diff(txn, |_| ()) {
            let attrs = part
                .attributes
                .as_ref()
                .and_then(|attrs| attrs.get("noteLink"));
            let Some(Any::Map(attrs)) = attrs else {
                previous = Value::Null;
                continue;
            };
            let Some(title) = attrs
                .get("title")
                .and_then(string)
                .filter(|title| !title.is_empty())
            else {
                previous = Value::Null;
                continue;
            };
            let link = json!({
                "targetId": attrs.get("noteId").and_then(string).filter(|value| !value.is_empty()),
                "pageFrameId": attrs.get("pageFrameId").and_then(string).filter(|value| !value.is_empty()),
                "title": title, "snippet": snippet
            });
            if link != previous {
                links.push(link.clone());
            }
            previous = link;
        }
    }
}

fn walk_links<T: ReadTxn>(txn: &T, node: XmlOut, links: &mut Vec<Value>) {
    match node {
        XmlOut::Element(element) => {
            let name = element.tag();
            if matches!(
                name.as_ref(),
                "paragraph"
                    | "heading"
                    | "bulletListItem"
                    | "orderedListItem"
                    | "checkListItem"
                    | "blockquote"
            ) {
                let context = snippet(xml_text(txn, &XmlOut::Element(element.clone())));
                block_links(txn, element.children(txn).collect(), &context, links);
            } else if !matches!(name.as_ref(), "codeBlock" | "mathBlock") {
                for child in element.children(txn) {
                    walk_links(txn, child, links);
                }
            }
        }
        XmlOut::Fragment(fragment) => {
            for child in fragment.children(txn) {
                walk_links(txn, child, links);
            }
        }
        XmlOut::Text(_) => {}
    }
}

pub(super) fn links(doc: &Doc) -> Vec<Value> {
    let txn = doc.transact();
    let mut links = Vec::new();
    if let Some(elements) = txn.get_array("elements") {
        for value in elements.iter(&txn) {
            let Out::YMap(element) = value else {
                continue;
            };
            let is_frame = matches!(element.get(&txn, "type"), Some(Out::Any(Any::Number(value))) if value == 3.0);
            if !is_frame {
                continue;
            }
            if let Some(Out::Any(Any::String(uuid))) = element.get(&txn, "uuid") {
                if let Some(fragment) = txn.get_xml_fragment(format!("pf-{uuid}").as_str()) {
                    walk_links(&txn, XmlOut::Fragment(fragment), &mut links);
                }
            }
        }
    }
    links
}
