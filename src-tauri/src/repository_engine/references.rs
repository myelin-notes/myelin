use super::{document, store::Store, Changes, DocumentNotification};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use yrs::{Any, Array, Doc, Map, Out, ReadTxn, Text, Transact, XmlFragment, XmlOut, XmlTextRef};

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceKind {
    Note,
    PageFrame,
}

fn renamed_title(title: &str, name: &str, kind: &ReferenceKind) -> String {
    let mut escaped = false;
    let frame = title.char_indices().find_map(|(index, ch)| {
        if escaped {
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '#' {
            return Some(index);
        }
        None
    });
    let name = name.replace('\\', "\\\\").replace('#', "\\#");
    match kind {
        ReferenceKind::Note => {
            let end = frame.unwrap_or(title.len());
            let start = title[..end].rfind('/').map_or(0, |index| index + 1);
            format!("{}{name}{}", &title[..start], &title[end..])
        }
        ReferenceKind::PageFrame => frame
            .map(|index| format!("{}#{name}", &title[..index]))
            .unwrap_or_else(|| title.into()),
    }
}

struct TextRange {
    text: XmlTextRef,
    index: u32,
    len: u32,
}

#[derive(Default)]
struct LinkRun {
    attrs: Option<Any>,
    content: String,
    ranges: Vec<TextRange>,
}

struct Rewrite {
    ranges: Vec<TextRange>,
    title: String,
    attrs: yrs::types::Attrs,
}

impl LinkRun {
    fn finish(
        &mut self,
        target: &str,
        name: &str,
        kind: &ReferenceKind,
        rewrites: &mut Vec<Rewrite>,
    ) {
        let Some(Any::Map(attrs)) = &self.attrs else {
            *self = Self::default();
            return;
        };
        let field = match kind {
            ReferenceKind::Note => "noteId",
            ReferenceKind::PageFrame => "pageFrameId",
        };
        let Some(title) = attrs.get("title").and_then(document::string) else {
            *self = Self::default();
            return;
        };
        if attrs.get(field).and_then(document::string) == Some(target) {
            let next = renamed_title(title, name, kind);
            if next != title {
                let needle = format!("[[{title}]]");
                for (start, _) in self.content.match_indices(&needle) {
                    let end = start + needle.len();
                    let mut offset = 0;
                    let mut ranges = Vec::new();
                    for range in &self.ranges {
                        let range_end = offset + range.len as usize;
                        let from = start.max(offset);
                        let to = end.min(range_end);
                        if from < to {
                            ranges.push(TextRange {
                                text: range.text.clone(),
                                index: range.index + (from - offset) as u32,
                                len: (to - from) as u32,
                            });
                        }
                        offset = range_end;
                    }
                    let mut attrs = attrs.as_ref().clone();
                    attrs.insert("title".into(), Any::String(next.clone().into()));
                    rewrites.push(Rewrite {
                        ranges,
                        title: next.clone(),
                        attrs: HashMap::from([("noteLink".into(), Any::Map(attrs.into()))]),
                    });
                }
            }
        }
        *self = Self::default();
    }
}

fn collect<T: ReadTxn>(
    txn: &T,
    node: XmlOut,
    target: &str,
    name: &str,
    kind: &ReferenceKind,
    rewrites: &mut Vec<Rewrite>,
) {
    let children: Vec<XmlOut> = match node {
        XmlOut::Element(element) if matches!(element.tag().as_ref(), "codeBlock" | "mathBlock") => {
            return
        }
        XmlOut::Element(element) => element.children(txn).collect(),
        XmlOut::Fragment(fragment) => fragment.children(txn).collect(),
        XmlOut::Text(_) => return,
    };
    let mut run = LinkRun::default();
    for child in children {
        if let XmlOut::Text(text) = child {
            let mut index = 0;
            for part in text.diff(txn, |_| ()) {
                let attrs = part
                    .attributes
                    .as_ref()
                    .and_then(|attrs| attrs.get("noteLink"))
                    .cloned();
                if attrs != run.attrs {
                    run.finish(target, name, kind, rewrites);
                    run.attrs = attrs;
                }
                if let Out::Any(Any::String(content)) = part.insert {
                    // yrs documents use UTF-8 byte offsets.
                    let len = content.len() as u32;
                    run.content.push_str(&content);
                    run.ranges.push(TextRange {
                        text: text.clone(),
                        index,
                        len,
                    });
                    index += len;
                } else {
                    run.finish(target, name, kind, rewrites);
                    index += 1;
                }
            }
        } else {
            run.finish(target, name, kind, rewrites);
            collect(txn, child, target, name, kind, rewrites);
        }
    }
    run.finish(target, name, kind, rewrites);
}

fn rewrite(doc: &Doc, target: &str, name: &str, kind: &ReferenceKind) -> usize {
    let mut txn = doc.transact_mut();
    let mut rewrites = Vec::new();
    if let Some(elements) = txn.get_array("elements") {
        for value in elements.iter(&txn) {
            let Out::YMap(element) = value else { continue };
            if !matches!(element.get(&txn, "type"), Some(Out::Any(Any::Number(value))) if value == 3.0)
            {
                continue;
            }
            if let Some(Out::Any(Any::String(uuid))) = element.get(&txn, "uuid") {
                if let Some(fragment) = txn.get_xml_fragment(format!("pf-{uuid}")) {
                    collect(
                        &txn,
                        XmlOut::Fragment(fragment),
                        target,
                        name,
                        kind,
                        &mut rewrites,
                    );
                }
            }
        }
    }
    let count = rewrites.len();
    for rewrite in rewrites.into_iter().rev() {
        for range in rewrite.ranges.iter().rev() {
            range.text.remove_range(&mut txn, range.index, range.len);
        }
        let first = &rewrite.ranges[0];
        first.text.insert_with_attributes(
            &mut txn,
            first.index,
            &format!("[[{}]]", rewrite.title),
            rewrite.attrs,
        );
    }
    count
}

pub(super) fn rename(
    state: &mut Store,
    sources: Vec<String>,
    target: String,
    name: String,
    kind: ReferenceKind,
) -> Result<(Value, Changes), String> {
    let mut changes = Changes::default();
    let mut source_count = 0;
    let mut link_count = 0;
    let mut seen = HashSet::new();
    let mut updates = Vec::new();
    for id in sources {
        if !seen.insert(id.clone()) || state.manifest["nodes"][&id]["fileType"] != "mcanvas" {
            continue;
        }
        let before = document::vector(state.doc(&id)?);
        state.transaction_active = true;
        let count = rewrite(state.doc(&id)?, &target, &name, &kind);
        if count == 0 {
            continue;
        }
        let (update, _) = document::diff(state.doc(&id)?, Some(&before))?;
        let generation = state
            .sync
            .document_generations
            .entry(id.clone())
            .or_insert_with(|| uuid::Uuid::new_v4().to_string())
            .clone();
        state.touch_document(&id, true)?;
        updates.push((id.clone(), update.clone()));
        changes.changed.push(id.clone());
        changes.documents.push(DocumentNotification {
            node_id: id,
            bytes: update,
            source_session: None,
            origin: "local".into(),
            generation,
            replacement: false,
        });
        source_count += 1;
        link_count += count;
    }
    if updates.is_empty() {
        state.transaction_active = false;
    } else {
        state.commit_updates(updates)?;
    }
    changes.wake_remote = source_count > 0 && state.remote;
    Ok((
        json!({"sourceCount": source_count, "linkCount": link_count}),
        changes,
    ))
}
